package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/telemetry"
)

type IdleChecker struct {
	client  kubernetes.Interface
	dynamic dynamic.Interface
	config  *config.Config
	// busyProbe reports whether an agent's pod is mid-work and must not be
	// hibernated. Defaults to the live HTTP probe (podIsBusy); overridable in
	// tests so the busy-guard branch can be exercised without a real pod.
	busyProbe func(ctx context.Context, agentName string) bool
}

func NewIdleChecker(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *IdleChecker {
	c := &IdleChecker{client: client, dynamic: dyn, config: cfg}
	c.busyProbe = c.podIsBusy
	return c
}

// RunLoop periodically scans running agents and hibernates idle ones.
// It blocks until ctx is cancelled.
func (c *IdleChecker) RunLoop(ctx context.Context) {
	timeout := c.config.AgentBase.IdleTimeout.AsDuration()
	if timeout <= 0 {
		slog.Info("idle checker disabled (timeout <= 0)")
		return
	}

	interval := c.checkInterval()
	slog.Info("idle checker started", "timeout", timeout, "interval", interval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.check(ctx)
		}
	}
}

// checkInterval returns how often to run idle checks — 1/6 of the timeout, clamped to [30s, 5m].
func (c *IdleChecker) checkInterval() time.Duration {
	d := c.config.AgentBase.IdleTimeout.AsDuration() / 6
	if d < 30*time.Second {
		d = 30 * time.Second
	}
	if d > 5*time.Minute {
		d = 5 * time.Minute
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
	hibernated := 0
	for i := range agents.Items {
		agent := &agents.Items[i]
		name := agent.GetName()
		// Active by activity annotations → not an idle candidate. This is the
		// exact decision the reconciler uses to scale up, so the two
		// can never disagree about whether an agent is idle.
		if shouldRun(agent.GetAnnotations(), effectiveIdleTimeout(hibernationOverride(agent), timeout), now) {
			continue
		}

		// Probe the pod — a long-running session, trigger, or terminal that
		// hasn't bumped last-activity must not be hibernated out from under
		// itself. This guard is why scale-down lives here, not in the
		// reconciler.
		if c.busyProbe(ctx, name) {
			slog.Info("idle checker: skipping busy agent", "agent", name)
			continue
		}

		slog.Info("hibernating idle agent", "agent", name)
		if err := c.hibernate(ctx, name); err != nil {
			slog.Error("idle checker: hibernating", "agent", name, "error", err)
			continue
		}
		hibernated++
	}
	// Each idle candidate triggers a 3s-timeout busy-probe, so the duration
	// shows when a sweep over unreachable pods runs long.
	slog.Debug("idle checker sweep complete",
		"scanned", len(agents.Items), "hibernated", hibernated, "duration", time.Since(start))
}

// hibernationOverride reads the per-agent spec.hibernationTimeout from the unstructured agent; nil when absent or unparseable (inherit the global).
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

// podIsBusy probes the agent runtime's /api/status endpoint. The runtime is
// authoritative about its own idleness — it reports a single idle flag and the
// controller does not re-derive busy-ness from raw counters. A runtime too old
// to report the flag parses as idle=false, i.e. busy, which fails safe.
// Returns false (not busy) on any error — allows hibernation if the pod is unreachable.
func (c *IdleChecker) podIsBusy(ctx context.Context, agentName string) bool {
	url := fmt.Sprintf("http://%s-0.%s.%s.svc:8080/api/status", agentName, agentName, c.config.Namespace)
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

// hibernate scales an agent's paired StatefulSets (agent + gateway, both
// labelled LabelAgent=name) to zero and records the Hibernated phase on the
// Agent status subresource. The idle checker is the sole scale-down
// authority and never writes spec — run state is derived from activity, not a
// stored desiredState. Idempotent: a StatefulSet already at zero is left
// untouched.
func (c *IdleChecker) hibernate(ctx context.Context, name string) error {
	sss, err := c.client.AppsV1().StatefulSets(c.config.Namespace).List(ctx, metav1.ListOptions{
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
			fresh, err := c.client.AppsV1().StatefulSets(c.config.Namespace).Get(ctx, ssName, metav1.GetOptions{})
			if err != nil {
				return err
			}
			zero := int32(0)
			fresh.Spec.Replicas = &zero
			_, err = c.client.AppsV1().StatefulSets(c.config.Namespace).Update(ctx, fresh, metav1.UpdateOptions{})
			return err
		}); err != nil {
			return fmt.Errorf("scaling down statefulset %s: %w", ssName, err)
		}
	}
	return updateAgentStatus(ctx, c.dynamic, c.config.Namespace, name, func(s *apiv1.AgentStatus) {
		// Pods are gone, so the agent is not routable until woken — reflect that
		// on Ready (the api-server's routing signal). The Hibernated reason lets
		// consumers tell this from a still-starting agent.
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionGatewayPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", apiv1.ReasonHibernated, "", 0)
	})
}
