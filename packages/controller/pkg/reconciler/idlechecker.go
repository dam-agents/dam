package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
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
)

type IdleChecker struct {
	client                  kubernetes.Interface
	dynamic                 dynamic.Interface
	config                  *config.Config
	halt                    MachineHalt
	busyProbe               func(ctx context.Context, agentName string) bool
	shortestObservedTimeout atomic.Int64
}

func (c *IdleChecker) WithMachineHalt(halt MachineHalt) *IdleChecker {
	c.halt = halt
	return c
}

func NewIdleChecker(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *IdleChecker {
	c := &IdleChecker{client: client, dynamic: dyn, config: cfg}
	c.busyProbe = func(ctx context.Context, name string) bool {
		return agentPodIsBusy(ctx, c.config.Namespace, name)
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

		if _, stamped := agent.GetAnnotations()[annHibernatedAt]; hibernationPublished(agent) && (atZero[name] || stamped) {
			if !atZero[name] && !gatewayKeptWarm(agent.GetAnnotations(), isVMObject(agent), c.config.AgentBase, now) {
				slog.Info("scaling down the gateway of a hibernated agent past its warm window", "agent", name)
				if err := scaleAgentPairToZero(ctx, c.client, c.dynamic, nil, agent.GetLabels()[envoyOwnerLabel], c.config.Namespace, name, false); err != nil {
					slog.Error("idle checker: scaling down a warm gateway", "agent", name, "error", err)
				}
			}
			continue
		}

		if c.busyProbe(ctx, name) {
			slog.Info("idle checker: skipping busy agent", "agent", name)
			continue
		}

		slog.Info("hibernating idle agent", "agent", name)
		keep := gatewayKeptWarm(agent.GetAnnotations(), isVMObject(agent), c.config.AgentBase, now)
		if err := hibernateAgentPair(ctx, c.client, c.dynamic, c.halt, agent.GetLabels()[envoyOwnerLabel], c.config.Namespace, name, keep, true); err != nil {
			slog.Error("idle checker: hibernating", "agent", name, "error", err)
			continue
		}
		hibernated++
	}
	c.shortestObservedTimeout.Store(int64(shortest))
	slog.Debug("idle checker sweep complete",
		"scanned", len(agents.Items), "hibernated", hibernated, "duration", time.Since(start))
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

func agentPodIsBusy(ctx context.Context, namespace, agentName string) bool {
	url := fmt.Sprintf("http://%s.%s.svc:8080/api/status", agentName, namespace)
	client := &http.Client{Timeout: 3 * time.Second, Transport: telemetry.WrapTransport(nil)}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}
	var status struct {
		Idle bool `json:"idle"`
	}
	if err := json.Unmarshal(body, &status); err != nil {
		return false
	}
	return !status.Idle
}

// UNIT_BOUNDARY_DESCRIPTION: hibernation is published only once the agent's machine is stopped. The api-server trusts a health check answer on a wake from a published hibernation, because nothing should answer then, so a machine still running would pass for a woken one. When the runner cannot stop the machine, the rest of the pair goes down anyway and readiness goes down, but the agent is not reported hibernated: the error makes the idle checker try again on its next sweep, and the agent's next reconcile stops the machine once the runner answers, as the hibernation is stamped before the machine is asked to stop. `keepGateway` leaves a vm agent's gateway up through the hibernation; `fresh` says the idle checker or reclaim starts a new hibernation here, rather than a reconcile holding a stop.
func hibernateAgentPair(ctx context.Context, kube kubernetes.Interface, dyn dynamic.Interface, halt MachineHalt, owner, namespace, name string, keepGateway, fresh bool) error {
	if err := stampHibernated(ctx, dyn, namespace, name, fresh); err != nil {
		return err
	}
	var haltErr error
	if halt != nil {
		haltErr = halt(ctx, owner, name)
	}
	if err := scaleAgentPairToZero(ctx, kube, dyn, nil, owner, namespace, name, keepGateway); err != nil {
		return err
	}
	if haltErr != nil {
		msg := fmt.Sprintf("hibernating: the machine has not stopped yet: %v", haltErr)
		if err := updateAgentStatus(ctx, dyn, namespace, name, func(s *apiv1.AgentStatus) {
			setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", vmrunner.ReasonNotReady, msg, 0)
			setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", "PodsNotReady", "", 0)
		}); err != nil {
			return err
		}
		return fmt.Errorf("stopping the machine of %s: %w", name, haltErr)
	}
	return updateAgentStatus(ctx, dyn, namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionGatewayPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", apiv1.ReasonHibernated, "", 0)
		s.AgentPodRestarts = 0
		s.AgentPodRestartReason = ""
	})
}

// UNIT_BOUNDARY_DESCRIPTION: a machine that cannot be stopped now — its runner is restarting or unreachable — does not keep the rest of the pair up. The gateway is scaled down anyway, and the agent's own next reconcile, which asks for the machine stopped because the agent should not run, stops it once the runner answers.
func scaleAgentPairToZero(ctx context.Context, kube kubernetes.Interface, dyn dynamic.Interface, halt MachineHalt, owner, namespace, name string, keepGateway bool) error {
	if err := stampHibernated(ctx, dyn, namespace, name, false); err != nil {
		return err
	}
	if halt != nil {
		if err := halt(ctx, owner, name); err != nil {
			slog.WarnContext(ctx, "stopping the agent's machine failed; scaling the rest down, the next reconcile stops the machine", "agent", name, "owner", owner, "error", err)
		}
	}
	sss, err := kube.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + name,
	})
	if err != nil {
		return fmt.Errorf("listing statefulsets for %s: %w", name, err)
	}
	for i := range sss.Items {
		ss := &sss.Items[i]
		if (ss.Spec.Replicas != nil && *ss.Spec.Replicas == 0) || (keepGateway && ss.Name == GatewayName(name)) {
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
