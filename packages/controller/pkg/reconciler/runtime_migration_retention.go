package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: a volume a runtime migration copied from outlives the move by a retention window, so an operator can still read the agent's work as it was before the move when something turns out wrong after it. A retained volume is taken out of everything that finds volumes by the agent and mount labels: they are removed, so the warm pool, the storage migration, the orphan sweep and a StatefulSet's claims no longer see it, and it carries a label of its own naming the agent, with annotations saying which path it held and until when it is kept. It is owned by the Agent, so it goes with the Agent even when the controller misses the delete.
const (
	LabelRetainedFor          = "agent-platform.ai/retained-for"
	annRetainedUntil          = "agent-platform.ai/retained-until"
	annRetainedMount          = "agent-platform.ai/retained-mount"
	defaultMigrationRetention = 7 * 24 * time.Hour
)

func (r *AgentReconciler) migrationRetention() time.Duration {
	if d := r.config.VM.RuntimeMigration.Retention.AsDuration(); d > 0 {
		return d
	}
	return defaultMigrationRetention
}

// UNIT_BOUNDARY_DESCRIPTION: marks one source volume retained. It is safe to repeat: a volume already retained keeps the window it was given, so a finish retried after a failed patch does not extend it, and a volume that is gone is nothing to keep.
func (r *AgentReconciler) retainMigratedVolume(ctx context.Context, agent *apiv1.Agent, pvcName, mountPath string, until time.Time) error {
	pvcs := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace)
	pvc, err := pvcs.Get(ctx, pvcName, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if pvc.Labels[LabelRetainedFor] == agent.Name {
		return nil
	}
	if pvc.Labels == nil {
		pvc.Labels = map[string]string{}
	}
	if pvc.Annotations == nil {
		pvc.Annotations = map[string]string{}
	}
	for _, l := range []string{LabelAgent, LabelMount, LabelPool, LabelPoolAvailable} {
		delete(pvc.Labels, l)
	}
	pvc.Labels[LabelRetainedFor] = agent.Name
	pvc.Annotations[annRetainedUntil] = until.UTC().Format(time.RFC3339)
	pvc.Annotations[annRetainedMount] = mountPath
	ref := agentOwnerRef(agent)
	ref.Controller = nil
	ref.BlockOwnerDeletion = nil
	pvc.OwnerReferences = append(pvc.OwnerReferences, ref)
	if _, err := pvcs.Update(ctx, pvc, metav1.UpdateOptions{}); err != nil {
		return fmt.Errorf("retaining the old volume %s: %w", pvcName, err)
	}
	slog.Info("runtime migration: old volume retained", "agent", agent.Name, "pvc", pvcName, "mount", mountPath, "until", until.UTC().Format(time.RFC3339))
	return nil
}

func (r *AgentReconciler) listRetainedVolumes(ctx context.Context, selector string) ([]corev1.PersistentVolumeClaim, error) {
	list, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a StatefulSet claims its volumes by name, not by label, so an Agent put back on the container backend by hand would mount the retained volume of the same name and quietly resume from its pre-migration home. Such an Agent is refused until an operator has recovered or deleted what is retained for it, since which of the two homes it should run on is theirs to decide.
func (r *AgentReconciler) refuseOverRetainedVolumes(ctx context.Context, agentName string) error {
	retained, err := r.listRetainedVolumes(ctx, LabelRetainedFor+"="+agentName)
	if err != nil {
		return err
	}
	if len(retained) == 0 {
		return nil
	}
	names := make([]string, 0, len(retained))
	for _, p := range retained {
		names = append(names, p.Name)
	}
	return fmt.Errorf("volumes retained from this agent's move to the vm backend (%s) would be mounted as its home again; recover or delete them before it runs on the container backend", strings.Join(names, ", "))
}

// UNIT_BOUNDARY_DESCRIPTION: the periodic sweep that ends retention: a volume past its window, or retained for an Agent that no longer exists, is deleted. A window an operator edited into something that is not a time is kept and warned about rather than read as expired, because deleting the one copy of an agent's old work on a typo cannot be undone.
func (r *AgentReconciler) ReconcileRetainedVolumes(ctx context.Context) {
	retained, err := r.listRetainedVolumes(ctx, LabelRetainedFor)
	if err != nil {
		slog.Warn("retained volume sweep: listing PVCs failed", "error", err)
		return
	}
	now := time.Now()
	for _, pvc := range retained {
		agentName := pvc.Labels[LabelRetainedFor]
		reason := ""
		if until, err := time.Parse(time.RFC3339, pvc.Annotations[annRetainedUntil]); err != nil {
			slog.Warn("retained volume sweep: keeping a volume whose window is not a time", "pvc", pvc.Name, "agent", agentName, annRetainedUntil, pvc.Annotations[annRetainedUntil])
		} else if now.After(until) {
			reason = "retention window passed"
		}
		if reason == "" {
			_, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, agentName, metav1.GetOptions{})
			if k8serrors.IsNotFound(err) {
				reason = "agent deleted"
			} else if err != nil {
				slog.Warn("retained volume sweep: agent lookup failed", "agent", agentName, "error", err)
				continue
			}
		}
		if reason == "" {
			continue
		}
		if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
			slog.Warn("retained volume sweep: delete failed", "pvc", pvc.Name, "agent", agentName, "error", err)
			continue
		}
		slog.Info("retained volume sweep: deleted", "pvc", pvc.Name, "agent", agentName, "reason", reason)
	}
}
