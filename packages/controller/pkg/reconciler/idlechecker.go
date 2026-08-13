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
	client    kubernetes.Interface
	dynamic   dynamic.Interface
	config    *config.Config
	busyProbe func(ctx context.Context, agentName string) bool
}

func NewIdleChecker(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *IdleChecker {
	c := &IdleChecker{client: client, dynamic: dyn, config: cfg}
	c.busyProbe = c.podIsBusy
	return c
}

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
		if shouldRun(agent.GetAnnotations(), effectiveIdleTimeout(hibernationOverride(agent), timeout), now) {
			continue
		}

		if c.busyProbe(ctx, name) {
			slog.Info("idle checker: skipping busy agent", "agent", name)
			continue
		}

		slog.Info("hibernating idle agent", "agent", name)
		if err := c.hibernate(ctx, name, isVMBackend(agent)); err != nil {
			slog.Error("idle checker: hibernating", "agent", name, "error", err)
			continue
		}
		hibernated++
	}
	slog.Debug("idle checker sweep complete",
		"scanned", len(agents.Items), "hibernated", hibernated, "duration", time.Since(start))
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

func (c *IdleChecker) hibernate(ctx context.Context, name string, vmBackend bool) error {
	return hibernateAgentPair(ctx, c.client, c.dynamic, c.config.Namespace, name, vmBackend)
}

func isVMBackend(agent *unstructured.Unstructured) bool {
	t, _, _ := unstructured.NestedString(agent.Object, "spec", "backend", "type")
	return t == "vm"
}

func hibernateAgentPair(ctx context.Context, kube kubernetes.Interface, dyn dynamic.Interface, namespace, name string, vmBackend bool) error {
	if err := scaleAgentPairToZero(ctx, kube, dyn, namespace, name, vmBackend); err != nil {
		return err
	}
	return updateAgentStatus(ctx, dyn, namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionGatewayPodReady, false, "PodReady", apiv1.ReasonHibernated, "", 0)
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", apiv1.ReasonHibernated, "", 0)
	})
}

func scaleAgentPairToZero(ctx context.Context, kube kubernetes.Interface, dyn dynamic.Interface, namespace, name string, vmBackend bool) error {
	if vmBackend {
		if err := haltAgentVMs(ctx, dyn, namespace, name); err != nil {
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
