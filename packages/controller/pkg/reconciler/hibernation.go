package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/util/retry"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	annActiveSession              = "agent-platform.ai/active-session"
	annLastActivity               = "agent-platform.ai/last-activity"
	annInvocationsActive          = "agent-platform.ai/invocations-active"
	annStopRequested              = "agent-platform.ai/stop-requested"
	annStorageMigration           = "agent-platform.ai/storage-migration"
	annStorageMigrationWasRunning = "agent-platform.ai/storage-migration-was-running"
	annReclaimedAt                = "agent-platform.ai/reclaimed-at"
	annSweepable                  = "agent-platform.ai/sweepable"
	annHibernatedAt               = "agent-platform.ai/hibernated-at"
)

func shouldRun(annotations map[string]string, idleTimeout time.Duration, now time.Time) bool {
	if annotations[annStopRequested] != "" || annotations[annStorageMigration] != "" {
		return false
	}
	if idleTimeout <= 0 {
		return true
	}
	if annotations[annActiveSession] == "true" {
		return true
	}
	if annotations[annInvocationsActive] == "true" {
		return true
	}
	last := annotations[annLastActivity]
	if last == "" {
		return true
	}
	t, err := time.Parse(time.RFC3339, last)
	if err != nil {
		return true
	}
	if r, err := time.Parse(time.RFC3339, annotations[annReclaimedAt]); err == nil && !t.After(r) {
		return false
	}
	return now.Sub(t) <= idleTimeout
}

// UNIT_BOUNDARY_DESCRIPTION: whether an Agent should run, with its runtime migration taken into account: nothing runs while the migration holds it down, and a boot the migration waits on runs whatever the activity says, unless a stop the user asked for since it began holds it or a storage migration gates it.
func shouldRunMigrating(annotations map[string]string, m runtimeMigration, idleTimeout time.Duration, now time.Time) bool {
	if m.holdsDown() {
		return false
	}
	if m.keepsUp() && !m.stopHolds(annotations) && annotations[annStorageMigration] == "" {
		return true
	}
	return shouldRun(annotations, idleTimeout, now)
}

func effectiveIdleTimeout(override *metav1.Duration, vm bool, base config.AgentBase) time.Duration {
	if vm {
		return base.VMIdleTimeout.AsDuration()
	}
	if override == nil {
		return base.IdleTimeout.AsDuration()
	}
	return override.Duration
}

// UNIT_BOUNDARY_DESCRIPTION: whether a vm Agent's gateway stays up while its machine is stopped: for the install's window after the Agent's last activity, so a wake soon after does not wait for a gateway pod to start, and not once someone asked for the Agent stopped. A gateway past the window is scaled down by the idle checker.
func gatewayKeptWarm(annotations map[string]string, vm bool, base config.AgentBase, now time.Time) bool {
	if !vm || annotations[annStopRequested] != "" || annotations[annStorageMigration] != "" {
		return false
	}
	last, err := time.Parse(time.RFC3339, annotations[annLastActivity])
	return err == nil && now.Sub(last) < base.VMGatewayWarmFor.AsDuration()
}

// UNIT_BOUNDARY_DESCRIPTION: the controller's own record that it took the Agent down — hibernated, stopped or parked — and holds its machine stopped until the next wake. It is written before the machine is asked to stop, so a reconcile that runs while the machine stops already reads it, and it is the only signal a vm Agent's hibernation is read from while its gateway stays up.
func stampHibernated(ctx context.Context, dyn dynamic.Interface, namespace, name string) error {
	cli := dyn.Resource(AgentsGVR).Namespace(namespace)
	agent, err := cli.Get(ctx, name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading agent %s: %w", name, err)
	}
	if _, ok := agent.GetAnnotations()[annHibernatedAt]; ok {
		return nil
	}
	raw, err := json.Marshal(map[string]any{
		"metadata": map[string]any{"annotations": map[string]string{annHibernatedAt: time.Now().UTC().Format(time.RFC3339Nano)}},
	})
	if err != nil {
		return err
	}
	if _, err := cli.Patch(ctx, name, types.MergePatchType, raw, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("stamping agent %s hibernated: %w", name, err)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: a wake removes the stamp it woke from, and only that one: the update carries the version it read, so a hibernation stamped while this reconcile ran, from activity it had not seen end, is read again and left in place.
func clearHibernated(ctx context.Context, dyn dynamic.Interface, namespace, name, seen string) error {
	cli := dyn.Resource(AgentsGVR).Namespace(namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		agent, err := cli.Get(ctx, name, metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		ann := agent.GetAnnotations()
		if v, ok := ann[annHibernatedAt]; !ok || v != seen {
			return nil
		}
		delete(ann, annHibernatedAt)
		agent.SetAnnotations(ann)
		_, err = cli.Update(ctx, agent, metav1.UpdateOptions{})
		return err
	})
}
