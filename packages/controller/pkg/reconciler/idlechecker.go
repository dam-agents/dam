package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	idleSweepsPerTimeout = 6
	minIdleCheckInterval = 15 * time.Second
	maxIdleCheckInterval = 5 * time.Minute
	vmStartHold          = 15 * time.Minute
)

type IdleChecker struct {
	client                  kubernetes.Interface
	dynamic                 dynamic.Interface
	config                  *config.Config
	halt                    MachineHalt
	ownerLock               func(owner string) *sync.Mutex
	ownerLocks              map[string]*sync.Mutex
	ownerLocksMu            sync.Mutex
	busyProbe               func(ctx context.Context, agentName string) bool
	shortestObservedTimeout atomic.Int64
}

func (c *IdleChecker) WithMachineHalt(halt MachineHalt) *IdleChecker {
	c.halt = halt
	return c
}

// UNIT_BOUNDARY_DESCRIPTION: hibernation and a runner roll start are serialized on the owner's lock, which the rollout takes too, so a roll cannot begin between the sweep's read of what a roll waits on and its scale-down. Without it the sweep decides from a snapshot, a roll starts while the pod is being probed, and the machine it needs comes back down.
func (c *IdleChecker) WithOwnerLock(lock func(owner string) *sync.Mutex) *IdleChecker {
	c.ownerLock = lock
	return c
}

func (c *IdleChecker) lockOf(owner string) *sync.Mutex {
	if c.ownerLock != nil {
		return c.ownerLock(owner)
	}
	c.ownerLocksMu.Lock()
	defer c.ownerLocksMu.Unlock()
	if c.ownerLocks == nil {
		c.ownerLocks = map[string]*sync.Mutex{}
	}
	if c.ownerLocks[owner] == nil {
		c.ownerLocks[owner] = &sync.Mutex{}
	}
	return c.ownerLocks[owner]
}

func NewIdleChecker(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *IdleChecker {
	c := &IdleChecker{client: client, dynamic: dyn, config: cfg}
	c.busyProbe = func(ctx context.Context, name string) bool {
		idle, answered := agentPodStatus(ctx, c.config.Namespace, name)
		return answered && !idle
	}
	return c
}

func (c *IdleChecker) RunLoop(ctx context.Context) {
	c.check(ctx)

	interval := c.checkInterval()
	slog.Info("idle checker started",
		"timeout", c.config.AgentBase.IdleTimeout.AsDuration(), "interval", interval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.check(ctx)
			if next := c.checkInterval(); next != interval {
				interval = next
				ticker.Reset(interval)
				slog.Info("idle checker interval adjusted", "interval", interval)
			}
		}
	}
}

func (c *IdleChecker) shortestEffectiveTimeout() time.Duration {
	global := c.config.AgentBase.IdleTimeout.AsDuration()
	observed := time.Duration(c.shortestObservedTimeout.Load())
	if observed > 0 && (global <= 0 || observed < global) {
		return observed
	}
	return global
}

func (c *IdleChecker) checkInterval() time.Duration {
	timeout := c.shortestEffectiveTimeout()
	if timeout <= 0 {
		return maxIdleCheckInterval
	}
	return min(max(timeout/idleSweepsPerTimeout, minIdleCheckInterval), maxIdleCheckInterval)
}

func (c *IdleChecker) check(ctx context.Context) {
	ctx, finish := telemetry.StartPass(ctx, "idle check")
	var passErr error
	defer func() { finish(passErr) }()
	start := time.Now()
	agents, err := c.dynamic.Resource(AgentsGVR).Namespace(c.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.ErrorContext(ctx, "idle checker: listing agents", "error", err)
		passErr = err
		return
	}

	now := time.Now().UTC()
	atZero := c.agentsAtZero(ctx)
	hibernated := 0
	shortest := time.Duration(0)
	for i := range agents.Items {
		agent := &agents.Items[i]
		name := agent.GetName()
		effective := effectiveIdleTimeout(hibernationOverride(agent), isVMObject(agent), c.config.AgentBase)
		if effective > 0 && (shortest == 0 || effective < shortest) {
			shortest = effective
		}
		if shouldRunMigrating(agent.GetAnnotations(), runtimeMigrationOfObject(agent), effective, now) {
			continue
		}

		if atZero[name] && hibernationPublished(agent) {
			continue
		}

		if !atZero[name] && vmStartHolds(agent, effective, now) {
			continue
		}

		if c.busyProbe(ctx, name) {
			slog.Info("idle checker: skipping busy agent", "agent", name)
			continue
		}

		hibernated += c.hibernateIdle(ctx, agent, name)
	}
	c.shortestObservedTimeout.Store(int64(shortest))
	slog.Debug("idle checker sweep complete",
		"scanned", len(agents.Items), "hibernated", hibernated, "duration", time.Since(start))
}

// UNIT_BOUNDARY_DESCRIPTION: hibernates one idle Agent, unless a runner roll started since the sweep read which machines are pinned. The owner's lock is the one a roll start takes, so holding it here makes the pin read and the halt one decision: a roll that begins while the pod is being probed is seen by the read inside the lock, and the machine it waits on is left up. The probe stays outside the lock, so the lock is never held for its three seconds.
func (c *IdleChecker) hibernateIdle(ctx context.Context, agent *unstructured.Unstructured, name string) int {
	owner := agent.GetLabels()[envoyOwnerLabel]
	lock := c.lockOf(owner)
	lock.Lock()
	defer lock.Unlock()
	pinned, err := c.machinesAwaitingRoll(ctx, owner)
	if err != nil {
		slog.ErrorContext(ctx, "idle checker: reading the machines a runner roll awaits", "agent", name, "error", err)
		return 0
	}
	if pinned[name] {
		slog.Info("idle checker: skipping a machine a runner roll waits on", "agent", name)
		return 0
	}
	slog.Info("hibernating idle agent", "agent", name)
	if err := c.hibernate(ctx, owner, name); err != nil {
		slog.Error("idle checker: hibernating", "agent", name, "error", err)
		return 0
	}
	return 1
}

// UNIT_BOUNDARY_DESCRIPTION: the machines a runner roll is waiting on, read from the runner Deployments' annotations. A hibernated machine never comes back ready, so hibernating one of them leaves the roll waiting out its settle timeout and gives up on machines that were only idle. The list is written when the roll starts and cleared in the same write that settles or gives up on it, so the pin lasts exactly as long as the wait. A roll marked stalled pins nothing: its own pod never became ready, so no machine of the owner's is what it waits on, and the mark outlives the settle timeout. An install without virtualization runs no runner, and its controller holds no grant on Deployments, so the read is skipped there rather than refused on every sweep. A read that fails on an install that does run them hibernates nothing this pass: the pin is what keeps a roll's machines up, and one sweep of waiting costs less than a roll that has to give up.
func (c *IdleChecker) machinesAwaitingRoll(ctx context.Context, owner string) (map[string]bool, error) {
	awaiting := map[string]bool{}
	if !c.config.VM.Enabled {
		return awaiting, nil
	}
	selector := "app.kubernetes.io/component=" + vmRunnerComponent
	if owner != "" {
		selector += "," + envoyOwnerLabel + "=" + owner
	}
	deps, err := c.client.AppsV1().Deployments(c.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("listing runners for the machines a roll awaits: %w", err)
	}
	for i := range deps.Items {
		dep := &deps.Items[i]
		if dep.Annotations[annRunnerRolledAt] == "" || dep.Annotations[annRunnerStalled] != "" {
			continue
		}
		for _, id := range strings.Split(dep.Annotations[annRunnerAwaiting], ",") {
			if id != "" {
				awaiting[id] = true
			}
		}
	}
	return awaiting, nil
}

func hibernationPublished(agent *unstructured.Unstructured) bool {
	conds, found, err := unstructured.NestedSlice(agent.Object, "status", "conditions")
	if err != nil || !found {
		return false
	}
	for _, raw := range conds {
		cond, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if cond["type"] == apiv1.ConditionReady && cond["reason"] == apiv1.ReasonHibernated {
			return true
		}
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: a cold first boot of a vm agent can outlast the idle timeout the wake started: an image no runner has cached, a fresh runner expanding its disk templates, a large nested guest. The idle clock therefore runs from the moment the agent turned ready, and a boot still in progress is never idle, so a scheduled fire is not lost to a hibernation mid-boot. A boot in progress is a machine not ready for no reason of its own and with no start failure decided — a machine the kernel, its seccomp filter or its runner's own OOM kill took down is booting again, and that reason says why it went down rather than that it is up to nothing; the start failure report ends the hold for a machine that runs without answering. The hold is capped at vmStartHold past the idle timeout, since a machine can read not ready for causes no start failure covers, such as an unreachable runner. A boot the runner reports copying a disk is held without that cap: the runner bounds it, for up to six hours, and a hibernation would stop the copy and start it again from nothing. It needs the pair awake, which the caller checks: a hibernation the runner has not confirmed reads not ready too.
func vmStartHolds(agent *unstructured.Unstructured, idleTimeout time.Duration, now time.Time) bool {
	ready, _, failed := vmStartConditions(agent)
	if !isVMObject(agent) || idleTimeout <= 0 || failed {
		return false
	}
	if ready != nil && ready["status"] == string(metav1.ConditionTrue) {
		since, _ := ready["lastTransitionTime"].(string)
		t, err := time.Parse(time.RFC3339, since)
		return err == nil && now.Sub(t) <= idleTimeout
	}
	return vmBootInProgress(agent, idleTimeout, now)
}

func vmBootInProgress(agent *unstructured.Unstructured, idleTimeout time.Duration, now time.Time) bool {
	ready, podReady, failed := vmStartConditions(agent)
	if !isVMObject(agent) || idleTimeout <= 0 || failed || ready != nil && ready["status"] == string(metav1.ConditionTrue) {
		return false
	}
	// UNIT_BOUNDARY_DESCRIPTION: a machine the kernel or its seccomp filter killed is booting again, which is held like any boot: the reason says why the machine went down, not that it is up to nothing.
	switch podReady["reason"] {
	case vmrunner.ReasonCopyingDisk:
		return true
	case vmrunner.ReasonNotReady, vmrunner.ReasonOOMKilled, vmrunner.ReasonSeccompKilled, apiv1.ReasonRunnerOutOfMemory:
	default:
		return false
	}
	last, err := time.Parse(time.RFC3339, agent.GetAnnotations()[annLastActivity])
	return err == nil && now.Sub(last) <= idleTimeout+vmStartHold
}

func vmStartConditions(agent *unstructured.Unstructured) (ready, podReady map[string]any, failed bool) {
	conds, _, _ := unstructured.NestedSlice(agent.Object, "status", "conditions")
	for _, raw := range conds {
		cond, _ := raw.(map[string]any)
		switch cond["type"] {
		case apiv1.ConditionReady:
			ready = cond
		case apiv1.ConditionAgentPodReady:
			podReady = cond
		case apiv1.ConditionStartFailed:
			failed = true
		}
	}
	return ready, podReady, failed
}

func (c *IdleChecker) agentsAtZero(ctx context.Context) map[string]bool {
	sss, err := c.client.AppsV1().
		StatefulSets(c.config.Namespace).
		List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.ErrorContext(ctx, "idle checker: listing statefulsets", "error", err)
		return nil
	}
	scaledUp := map[string]bool{}
	seen := map[string]bool{}
	for i := range sss.Items {
		ss := &sss.Items[i]
		name := ss.Labels[LabelAgent]
		if name == "" {
			continue
		}
		seen[name] = true
		if ss.Spec.Replicas == nil || *ss.Spec.Replicas != 0 {
			scaledUp[name] = true
		}
	}
	atZero := map[string]bool{}
	for name := range seen {
		atZero[name] = !scaledUp[name]
	}
	svcs, err := c.client.CoreV1().Services(c.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: LabelRole + "=" + RoleGateway})
	if err != nil {
		slog.ErrorContext(ctx, "idle checker: listing gateway services", "error", err)
		return atZero
	}
	for i := range svcs.Items {
		if up, ok := desiredUpRecord(&svcs.Items[i]); ok {
			atZero[svcs.Items[i].Labels[LabelAgent]] = !up
		}
	}
	return atZero
}

func isVMObject(agent *unstructured.Unstructured) bool {
	backend, _, _ := unstructured.NestedString(agent.Object, "spec", "backend", "type")
	return backend == "vm"
}

func hibernationOverride(agent *unstructured.Unstructured) *metav1.Duration {
	s, found, err := unstructured.NestedString(agent.Object, "spec", "hibernationTimeout")
	if err != nil || !found || s == "" {
		return nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return nil
	}
	return &metav1.Duration{Duration: d}
}

// UNIT_BOUNDARY_DESCRIPTION: reports whether the agent's `/api/status` says `idle`, and whether it answered at all within three seconds. The idle checker and a runner roll take a silence as idle, so an agent that is down still hibernates and a stuck guest does not hold up the roll that would replace it; a reclaim does not, since a guest saturated by a long turn is silent too.
func agentPodStatus(ctx context.Context, namespace, agentName string) (idle, answered bool) {
	url := fmt.Sprintf("http://%s.%s.svc:8080/api/status", agentName, namespace)
	client := &http.Client{Timeout: 3 * time.Second, Transport: telemetry.WrapTransport(nil)}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, false
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, false
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, false
	}
	var status struct {
		Idle bool `json:"idle"`
	}
	if err := json.Unmarshal(body, &status); err != nil {
		return false, false
	}
	return status.Idle, true
}

func (c *IdleChecker) hibernate(ctx context.Context, owner, name string) error {
	return hibernateAgentPair(ctx, c.client, c.dynamic, c.halt, owner, c.config.Namespace, name)
}

// UNIT_BOUNDARY_DESCRIPTION: hibernation is published only once the agent's machine is stopped. The api-server trusts a health check answer on a wake from a published hibernation, because nothing should answer then, so a machine still running would pass for a woken one. When the runner cannot stop the machine, the gateway is scaled down anyway and readiness goes down, but the agent is not reported hibernated: the error makes the idle checker try again on its next sweep, and the agent's next reconcile stops the machine once the runner answers. A machine the runner is still stopping is no error: the agent reads as stopping, and its reconcile watches the machine and publishes hibernation once it reads stopped.
func hibernateAgentPair(ctx context.Context, kube kubernetes.Interface, dyn dynamic.Interface, halt MachineHalt, owner, namespace, name string) error {
	var haltErr error
	if halt != nil {
		haltErr = halt(ctx, owner, name)
	}
	if err := scaleAgentPairToZero(ctx, kube, nil, owner, namespace, name); err != nil {
		return err
	}
	if haltErr != nil {
		stopping := errors.Is(haltErr, errMachineStopping)
		reason, msg := vmrunner.ReasonNotReady, fmt.Sprintf("hibernating: the machine has not stopped yet: %v", haltErr)
		if stopping {
			reason, msg = apiv1.ReasonMachineStopping, "hibernating: the machine is stopping"
		}
		if err := updateAgentStatus(ctx, dyn, namespace, name, func(s *apiv1.AgentStatus) {
			setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", reason, msg, 0)
			setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", "PodsNotReady", "", 0)
		}); err != nil {
			return err
		}
		if stopping {
			return nil
		}
		return fmt.Errorf("stopping the machine of %s: %w", name, haltErr)
	}
	return publishHibernated(ctx, dyn, namespace, name)
}

func publishHibernated(ctx context.Context, dyn dynamic.Interface, namespace, name string) error {
	return updateAgentStatus(ctx, dyn, namespace, name, hibernatedStatus)
}

// UNIT_BOUNDARY_DESCRIPTION: the conditions a hibernated agent carries, for the reconcile that writes them beside the kill in one status update.
func hibernatedStatus(s *apiv1.AgentStatus) {
	setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
	setStatusCondition(s, apiv1.ConditionGatewayPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
	setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", apiv1.ReasonHibernated, "", 0)
	s.AgentPodRestarts = 0
	s.AgentPodRestartReason = ""
}

// UNIT_BOUNDARY_DESCRIPTION: a machine that cannot be stopped now — its runner is restarting or unreachable — does not keep the rest of the pair up. The gateway is scaled down anyway, and the agent's own next reconcile, which asks for the machine stopped because the agent should not run, stops it once the runner answers.
func scaleAgentPairToZero(ctx context.Context, kube kubernetes.Interface, halt MachineHalt, owner, namespace, name string) error {
	if halt != nil {
		if err := halt(ctx, owner, name); err != nil && !errors.Is(err, errMachineStopping) {
			slog.WarnContext(ctx, "stopping the agent's machine failed; scaling the rest down, the next reconcile stops the machine", "agent", name, "owner", owner, "error", err)
		}
	}
	if err := recordDesiredUp(ctx, kube, namespace, name, false); err != nil {
		return fmt.Errorf("recording %s down: %w", name, err)
	}
	sss, err := kube.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + name,
	})
	if err != nil {
		return fmt.Errorf("listing statefulsets for %s: %w", name, err)
	}
	for i := range sss.Items {
		ss := &sss.Items[i]
		if ss.Spec.Replicas != nil && *ss.Spec.Replicas == 0 {
			continue
		}
		ssName := ss.Name
		if err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
			fresh, err := kube.AppsV1().StatefulSets(namespace).Get(ctx, ssName, metav1.GetOptions{})
			if err != nil {
				return err
			}
			zero := int32(0)
			fresh.Spec.Replicas = &zero
			_, err = kube.AppsV1().StatefulSets(namespace).Update(ctx, fresh, metav1.UpdateOptions{})
			return err
		}); err != nil {
			return fmt.Errorf("scaling down statefulset %s: %w", ssName, err)
		}
	}
	return nil
}

type MachineHalt func(ctx context.Context, owner, name string) error
