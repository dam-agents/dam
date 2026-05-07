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
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"
	"gopkg.in/yaml.v3"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

type IdleChecker struct {
	client kubernetes.Interface
	config *config.Config
}

func NewIdleChecker(client kubernetes.Interface, cfg *config.Config) *IdleChecker {
	return &IdleChecker{client: client, config: cfg}
}

// RunLoop periodically scans running instances and hibernates idle ones.
// It blocks until ctx is cancelled.
func (c *IdleChecker) RunLoop(ctx context.Context) {
	if c.config.IdleTimeout <= 0 {
		slog.Info("idle checker disabled (timeout <= 0)")
		return
	}

	interval := c.checkInterval()
	slog.Info("idle checker started", "timeout", c.config.IdleTimeout, "interval", interval)
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
	d := c.config.IdleTimeout / 6
	if d < 30*time.Second {
		d = 30 * time.Second
	}
	if d > 5*time.Minute {
		d = 5 * time.Minute
	}
	return d
}

func (c *IdleChecker) check(ctx context.Context) {
	cms, err := c.client.CoreV1().ConfigMaps(c.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "agent-platform.ai/type=agent-instance",
	})
	if err != nil {
		slog.Error("idle checker: listing instances", "error", err)
		return
	}

	now := time.Now().UTC()
	for _, cm := range cms.Items {
		spec, err := types.ParseInstanceSpec(cm.Data["spec.yaml"])
		if err != nil || spec.DesiredState != "running" {
			continue
		}

		// Skip instances with an active session
		if cm.Annotations["agent-platform.ai/active-session"] == "true" {
			continue
		}

		lastActivity := cm.Annotations["agent-platform.ai/last-activity"]
		if lastActivity == "" {
			continue
		}

		t, err := time.Parse(time.RFC3339, lastActivity)
		if err != nil {
			slog.Warn("idle checker: invalid last-activity", "instance", cm.Name, "value", lastActivity)
			continue
		}

		if now.Sub(t) <= c.config.IdleTimeout {
			continue
		}

		// Probe the pod — if it has active sessions or triggers, skip hibernation
		if c.podIsBusy(cm.Name) {
			slog.Info("idle checker: skipping busy instance", "instance", cm.Name)
			continue
		}

		slog.Info("hibernating idle instance", "instance", cm.Name, "idle", now.Sub(t).Round(time.Second))
		if err := c.hibernate(ctx, cm.Name); err != nil {
			slog.Error("idle checker: hibernating", "instance", cm.Name, "error", err)
		}
	}
}

// podIsBusy probes the agent runtime's /api/status endpoint to check for active sessions or triggers.
// Returns false (not busy) on any error — allows hibernation if the pod is unreachable.
func (c *IdleChecker) podIsBusy(instanceName string) bool {
	url := fmt.Sprintf("http://%s-0.%s.%s.svc:8080/api/status", instanceName, instanceName, c.config.Namespace)
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}
	var status struct {
		ActiveSessions int  `json:"activeSessions"`
		ActiveTriggers int  `json:"activeTriggers"`
		TerminalActive bool `json:"terminalActive"`
	}
	if err := json.Unmarshal(body, &status); err != nil {
		return false
	}
	return status.ActiveSessions > 0 || status.ActiveTriggers > 0 || status.TerminalActive
}

func (c *IdleChecker) hibernate(ctx context.Context, name string) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		fresh, err := c.client.CoreV1().ConfigMaps(c.config.Namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return err
		}
		freshSpec, err := types.ParseInstanceSpec(fresh.Data["spec.yaml"])
		if err != nil {
			return err
		}
		if freshSpec.DesiredState != "running" {
			return nil // already changed by someone else
		}
		freshSpec.DesiredState = "hibernated"
		specYAML, err := yaml.Marshal(freshSpec)
		if err != nil {
			return err
		}
		fresh.Data["spec.yaml"] = string(specYAML)
		_, err = c.client.CoreV1().ConfigMaps(c.config.Namespace).Update(ctx, fresh, metav1.UpdateOptions{})
		return err
	})
}
