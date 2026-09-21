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
	c.busyProbe = c.podIsBusy
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
	d := timeout / idleSweepsPerTimeout
	if d < minIdleCheckInterval {
		d = minIdleCheckInterval
	}
	if d > maxIdleCheckInterval {
		d = maxIdleCheckInterval
	}
	return d
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
	timeout := c.config.AgentBase.IdleTimeout.AsDuration()
	atZero := c.agentsAtZero(ctx)
	hibernated := 0
	shortest := time.Duration(0)
	for i := range agents.Items {
		agent := &agents.Items[i]
		name := agent.GetName()
		effective := effectiveIdleTimeout(hibernationOverride(agent), timeout)
		if effective > 0 && (shortest == 0 || effective < shortest) {
			shortest = effective
		}
		if shouldRun(agent.GetAnnotations(), effective, now) {
			continue
		}

		if atZero[name] && hibernationPublished(agent) {
			continue
		}

		if c.busyProbe(ctx, name) {
			slog.Info("idle checker: skipping busy agent", "agent", name)
			continue
		}

		slog.Info("hibernating idle agent", "agent", name)
		if err := c.hibernate(ctx, ownerOf(agent), name); err != nil {
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

func (c *IdleChecker) podIsBusy(ctx context.Context, agentName string) bool {
	return agentPodIsBusy(ctx, c.config.Namespace, agentName)
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

func (c *IdleChecker) hibernate(ctx context.Context, owner, name string) error {
	return hibernateAgentPair(ctx, c.client, c.dynamic, c.halt, owner, c.config.Namespace, name)
}

func hibernateAgentPair(ctx context.Context, kube kubernetes.Interface, dyn dynamic.Interface, halt MachineHalt, owner, namespace, name string) error {
	if err := scaleAgentPairToZero(ctx, kube, halt, owner, namespace, name); err != nil {
		return err
	}
	return updateAgentStatus(ctx, dyn, namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionGatewayPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", apiv1.ReasonHibernated, "", 0)
		s.AgentPodRestarts = 0
		s.AgentPodRestartReason = ""
	})
}

func scaleAgentPairToZero(ctx context.Context, kube kubernetes.Interface, halt MachineHalt, owner, namespace, name string) error {
	if halt != nil {
		if err := halt(ctx, owner, name); err != nil {
			return err
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

func ownerOf(agent *unstructured.Unstructured) string {
	labels := agent.GetLabels()
	return labels[envoyOwnerLabel]
}
