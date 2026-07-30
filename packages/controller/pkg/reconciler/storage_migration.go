package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// One-time RWX -> RWO workspace-volume migration (#2988).
//
// Shared-writable storage existed for exactly one reason: a second pod
// (Slack fork, dam-run executor) writing into a live agent's workspace.
// Both writers are gone, so every workspace volume becomes ReadWriteOnce —
// but a PVC's access mode cannot change in place. This manager drains the
// old volumes: for every agent whose workspace PVC is still ReadWriteMany
// it forces the agent down, copies the volume onto a fresh RWO PVC in a
// Job (checksum-verified), re-points the StatefulSet, deletes the old
// volume, and restores the agent's prior run state.
//
// The whole flow is a state machine derived from cluster state, so it is
// safe to interrupt and resume at any point:
//
//	RWX PVC labeled to the agent            -> migration needed
//	annStorageMigration set, agent pod up   -> wait for the forced scale-down
//	target PVC / copy Job missing           -> create them
//	copy Job failed                         -> retry (delete + recreate, bounded pace)
//	copy Job succeeded                      -> flip: label target, strip+mark old,
//	                                           delete StatefulSet, delete old PVC,
//	                                           clear the gate, restore run state
//
// The copy runs only while the agent is scaled to zero, so the source is
// quiescent — a verified copy is a faithful copy. The old PVC is deleted at
// flip because the final rsync-equivalent pass is checksum-compared against
// the quiesced source; there is no post-flip grace copy to fall back to.
//
// The flip itself needs no StatefulSet surgery: the target PVC is labeled
// exactly like a claimed warm-pool spare (LabelAgent + LabelMount +
// LabelPool), so once the old StatefulSet is deleted the agent reconciler's
// claim recovery mounts the new volume by name on the next render.

const (
	// LabelMigrationFor marks a target PVC being filled for an agent, before
	// it is claimed (LabelAgent) at flip. Deliberately NOT LabelAgent: the
	// orphan-PVC sweep and the workspace resolvers key on LabelAgent, and a
	// half-copied volume must be invisible to both.
	LabelMigrationFor = "agent-platform.ai/migration-for"
	// LabelMigrationSuperseded marks a drained source PVC between the flip
	// and its deletion, after its LabelAgent/LabelMount are stripped.
	LabelMigrationSuperseded = "agent-platform.ai/superseded"
	// migrationPoolValue is the LabelPool value stamped onto a flipped
	// target so the agent reconciler's claim recovery (which requires
	// LabelPool alongside LabelAgent+LabelMount) mounts it by name.
	migrationPoolValue = "storage-migration"

	defaultMigrationInterval    = 30 * time.Second
	defaultMigrationConcurrency = 10
	// migrationJobRetryAfter bounds how fast a failed copy Job is deleted
	// and recreated, so a persistently failing copy (e.g. target class
	// misprovisioned) retries slowly instead of hot-looping.
	migrationJobRetryAfter = 10 * time.Minute
	// migrationJobDeadline fails a copy Job whose pod never reaches a
	// terminal state (unschedulable, image pull stuck) — without it the
	// gated agent would stay down forever with nothing retrying. Sized for
	// a large workspace on a slow shared-filesystem tier: the copy reads
	// the source three times (copy + two verification passes).
	migrationJobDeadline = 4 * time.Hour
	// migrationFallbackUID runs the copy when the chart doesn't pin the
	// agent container's uid. Matches the platform images' agent user.
	migrationFallbackUID = int64(65532)
)

// StorageMigrationManager runs the migration loop. Leader-only, like the
// warm pool: PVC creation, Job lifecycle, and the flip must not race a
// second replica.
type StorageMigrationManager struct {
	client  kubernetes.Interface
	dynamic dynamic.Interface
	config  *config.Config
	now     func() time.Time
	// skippedVM de-dupes the vm-backend warning so it logs once per agent
	// per process, not once per tick.
	skippedVM map[string]bool
}

func NewStorageMigrationManager(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *StorageMigrationManager {
	return &StorageMigrationManager{
		client:    client,
		dynamic:   dyn,
		config:    cfg,
		now:       time.Now,
		skippedVM: map[string]bool{},
	}
}

func (m *StorageMigrationManager) interval() time.Duration {
	if d := m.config.StorageMigration.Interval.AsDuration(); d > 0 {
		return d
	}
	return defaultMigrationInterval
}

func (m *StorageMigrationManager) concurrency() int {
	if c := m.config.StorageMigration.Concurrency; c > 0 {
		return c
	}
	return defaultMigrationConcurrency
}

// RunLoop reconciles until ctx is done. When disabled it first releases
// anything a previous run left gated, then stops for good.
func (m *StorageMigrationManager) RunLoop(ctx context.Context) {
	if !m.config.StorageMigration.Enabled {
		// Turning the migration off must never strand an agent: the gate is
		// a hard-stop-strength negative override that only this manager
		// clears, so a disabled manager that ignored existing gates would
		// leave those agents scaled to zero with nothing left to lift them.
		// Unwind instead — the off switch is an off switch.
		m.ReleaseGated(ctx)
		return
	}
	slog.Info("storage migration: manager started",
		"concurrency", m.concurrency(), "interval", m.interval().String())
	t := time.NewTicker(m.interval())
	defer t.Stop()
	for {
		m.Reconcile(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// ReleaseGated unwinds every in-flight migration and lifts its gate, so a
// disabled (or newly-disabled) migration leaves no agent parked. Two shapes,
// decided per agent by whether its source volume is still there:
//
//   - source still ReadWriteMany -> the copy never completed: bin the copy
//     Job and the unclaimed target, then lift the gate. The agent comes back
//     on the volume it never left, byte for byte — nothing was deleted.
//   - source gone -> the flip already ran: finish its tail (sweep the
//     superseded source, lift the gate, restore the prior run state).
//
// Idempotent, and safe to run at boot: an agent with no gate is skipped.
func (m *StorageMigrationManager) ReleaseGated(ctx context.Context) {
	agents, err := m.dynamic.Resource(AgentsGVR).Namespace(m.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("storage migration: listing agents to release gates failed", "error", err)
		return
	}
	rwx := map[string]bool{}
	if pvcs, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent,
	}); err == nil {
		for _, p := range pvcs.Items {
			if isRWX(p.Spec.AccessModes) {
				rwx[p.Labels[LabelAgent]] = true
			}
		}
	} else {
		slog.Warn("storage migration: listing PVCs to release gates failed", "error", err)
		return
	}

	for i := range agents.Items {
		agent, err := FromCacheObject[apiv1.Agent](&agents.Items[i])
		if err != nil || agent.Annotations[annStorageMigration] == "" {
			continue
		}
		if rwx[agent.Name] {
			// Abandon: the source is intact, so the target is half-copied
			// garbage. The selector only matches UNCLAIMED targets (a
			// flipped one carries the agent label instead), so a completed
			// migration's volume can never be caught here.
			prop := metav1.DeletePropagationBackground
			if err := m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, migrationJobName(agent.Name),
				metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !errors.IsNotFound(err) {
				slog.Warn("storage migration: deleting abandoned copy job failed", "agent", agent.Name, "error", err)
			}
			targets, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx,
				metav1.ListOptions{LabelSelector: LabelMigrationFor + "=" + agent.Name})
			if err != nil {
				slog.Warn("storage migration: listing abandoned targets failed", "agent", agent.Name, "error", err)
			} else {
				for _, t := range targets.Items {
					if err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).
						Delete(ctx, t.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
						slog.Warn("storage migration: deleting abandoned target failed", "agent", agent.Name, "pvc", t.Name, "error", err)
					}
				}
			}
			slog.Info("storage migration: released gated agent, migration abandoned", "agent", agent.Name)
		}
		if err := m.finishFlip(ctx, agent); err != nil {
			slog.Warn("storage migration: releasing gate failed", "agent", agent.Name, "error", err)
		}
	}
}

// Reconcile advances every in-flight migration one step and admits new
// agents up to the concurrency cap. Exported for tests; RunLoop drives it.
func (m *StorageMigrationManager) Reconcile(ctx context.Context) {
	pvcs, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent,
	})
	if err != nil {
		slog.Warn("storage migration: listing PVCs failed", "error", err)
		return
	}

	// Agents that still own an RWX workspace volume, plus agents already
	// gated (annotation set) whose source volume may already be stripped —
	// the union is the resumable work list.
	rwxByAgent := map[string][]corev1.PersistentVolumeClaim{}
	for _, p := range pvcs.Items {
		if !isRWX(p.Spec.AccessModes) {
			continue
		}
		agent := p.Labels[LabelAgent]
		rwxByAgent[agent] = append(rwxByAgent[agent], p)
	}

	agents, err := m.dynamic.Resource(AgentsGVR).Namespace(m.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("storage migration: listing agents failed", "error", err)
		return
	}
	inFlight := map[string]bool{}
	known := map[string]*apiv1.Agent{}
	for i := range agents.Items {
		agent, err := FromCacheObject[apiv1.Agent](&agents.Items[i])
		if err != nil {
			continue
		}
		known[agent.Name] = agent
		if agent.Annotations[annStorageMigration] != "" {
			inFlight[agent.Name] = true
		}
	}

	work := map[string]bool{}
	for name := range rwxByAgent {
		work[name] = true
	}
	for name := range inFlight {
		work[name] = true
	}

	names := make([]string, 0, len(work))
	for name := range work {
		names = append(names, name)
	}
	sort.Strings(names)

	slots := m.concurrency() - len(inFlight)
	for _, name := range names {
		agent, ok := known[name]
		if !ok {
			// PVC labeled to a deleted agent — the orphan sweep owns it.
			continue
		}
		if agent.Spec.IsVM() {
			// The VM path renders PVC references by constructed name, not by
			// claim recovery, so the flip below cannot re-point it. Loud and
			// deliberate: a vm-backend agent on RWX keeps its volume until
			// it is recreated.
			if !m.skippedVM[name] {
				slog.Warn("storage migration: skipping vm-backend agent — recreate it to move off shared storage", "agent", name)
				m.skippedVM[name] = true
			}
			continue
		}
		if !inFlight[name] {
			if slots <= 0 {
				continue
			}
			slots--
		}
		if err := m.migrateAgent(ctx, agent, rwxByAgent[name]); err != nil {
			slog.Warn("storage migration: agent migration step failed", "agent", name, "error", err)
		}
	}
}

func isRWX(modes []corev1.PersistentVolumeAccessMode) bool {
	for _, m := range modes {
		if m == corev1.ReadWriteMany {
			return true
		}
	}
	return false
}

// migrationTargetName derives the deterministic target PVC name so an
// interrupted migration resumes against the same object.
func migrationTargetName(oldPVC string) string {
	name := "mig-" + oldPVC
	if len(name) > 63 {
		name = name[:63]
	}
	return strings.TrimSuffix(name, "-")
}

func migrationJobName(agentName string) string {
	name := "mig-" + agentName
	if len(name) > 63 {
		name = name[:63]
	}
	return strings.TrimSuffix(name, "-")
}

// migrateAgent advances one agent's migration by one step. Every step is
// idempotent; the caller re-invokes each tick until nothing is left to do.
func (m *StorageMigrationManager) migrateAgent(ctx context.Context, agent *apiv1.Agent, rwxPVCs []corev1.PersistentVolumeClaim) error {
	name := agent.Name

	// Step 1 — gate the agent down. The annotation is a shouldRun negative
	// override; the agent reconciler scales the pair to zero immediately
	// (bypassing the busy probe) on the update event this patch triggers.
	if agent.Annotations[annStorageMigration] == "" {
		wasRunning, err := m.agentPodPresent(ctx, name)
		if err != nil {
			return err
		}
		slog.Info("storage migration: gating agent for migration", "agent", name, "wasRunning", wasRunning)
		return m.patchAgentAnnotations(ctx, name, map[string]*string{
			annStorageMigration:           ptrString("migrating"),
			annStorageMigrationWasRunning: ptrString(fmt.Sprintf("%t", wasRunning)),
		})
	}

	// Step 2 — wait until the agent pod is gone; the copy must read a
	// quiesced volume.
	if present, err := m.agentPodPresent(ctx, name); err != nil {
		return err
	} else if present {
		return nil // scale-down in progress; next tick
	}

	// Step 3 — ensure a target PVC per RWX source, and the copy Job. Both
	// carry an owner reference to the Agent CR so a mid-migration agent
	// deletion garbage-collects them instead of leaking a half-filled
	// volume nothing labels.
	if len(rwxPVCs) > 0 {
		ownerRef := agentOwnerRef(agent)
		pairs := make([]migrationPair, 0, len(rwxPVCs))
		for _, old := range rwxPVCs {
			mount := old.Labels[LabelMount]
			if mount == "" {
				// Pre-#692 PVCs carry no mount label; the mount name is the
				// PVC-name prefix by the `<mount>-<agent>-0` convention.
				mount = strings.TrimSuffix(old.Name, "-"+name+"-0")
			}
			target, err := m.ensureTargetPVC(ctx, name, mount, &old, ownerRef)
			if err != nil {
				return err
			}
			pairs = append(pairs, migrationPair{old: old.Name, target: target, mount: mount})
		}

		job, err := m.client.BatchV1().Jobs(m.config.Namespace).Get(ctx, migrationJobName(name), metav1.GetOptions{})
		if errors.IsNotFound(err) {
			desired := buildMigrationJob(name, pairs, m.config, ownerRef)
			if _, err := m.client.BatchV1().Jobs(m.config.Namespace).Create(ctx, desired, metav1.CreateOptions{}); err != nil {
				return fmt.Errorf("creating copy job: %w", err)
			}
			slog.Info("storage migration: copy job started", "agent", name, "volumes", len(pairs))
			return nil
		}
		if err != nil {
			return err
		}

		switch {
		case jobSucceeded(job):
			return m.flip(ctx, agent, pairs, job.Name)
		case jobFailed(job):
			// Bounded retry: leave the failed Job visible for a grace
			// window, then delete it so the next tick recreates it.
			if m.now().Sub(job.CreationTimestamp.Time) < migrationJobRetryAfter {
				return fmt.Errorf("copy job %s failed; retrying after %s", job.Name, migrationJobRetryAfter)
			}
			slog.Warn("storage migration: deleting failed copy job for retry", "agent", name, "job", job.Name)
			prop := metav1.DeletePropagationBackground
			return m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop})
		default:
			// Copy in flight — say so every tick, so an operator watching a
			// gated agent can tell "working" from "stuck" at a glance.
			slog.Info("storage migration: copy in progress", "agent", name,
				"job", job.Name, "age", m.now().Sub(job.CreationTimestamp.Time).Round(time.Second).String())
			return nil
		}
	}

	// No RWX volume left labeled to the agent: a crash landed between the
	// flip's label moves and the gate clearing. Finish the tail: delete any
	// superseded sources and lift the gate.
	return m.finishFlip(ctx, agent)
}

type migrationPair struct {
	old    string
	target string
	mount  string
}

// ensureTargetPVC creates (or finds) the RWO volume that will replace `old`.
// Size follows the source's request; class is the agents' configured class
// (empty = cluster default, WaitForFirstConsumer binding lands it on the
// copy Job's node).
func (m *StorageMigrationManager) ensureTargetPVC(ctx context.Context, agentName, mount string, old *corev1.PersistentVolumeClaim, ownerRef metav1.OwnerReference) (string, error) {
	targetName := migrationTargetName(old.Name)
	_, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Get(ctx, targetName, metav1.GetOptions{})
	if err == nil {
		return targetName, nil
	}
	if !errors.IsNotFound(err) {
		return "", err
	}

	size := old.Spec.Resources.Requests[corev1.ResourceStorage]
	if size.IsZero() {
		size = resource.MustParse(m.config.AgentTemplateDefaults.StorageSize)
	}
	spec := corev1.PersistentVolumeClaimSpec{
		AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
		Resources: corev1.VolumeResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceStorage: size},
		},
	}
	if sc := m.config.AgentBase.StorageClass; sc != "" {
		spec.StorageClassName = &sc
	}
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:            targetName,
			Namespace:       m.config.Namespace,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
			Labels: map[string]string{
				// LabelPool + LabelMount now, LabelAgent at flip — the
				// claim-recovery contract (see file comment). The pool label
				// also keeps the warm-pool trim away: it only touches PVCs
				// carrying its own pool keys and the available marker.
				LabelPool:         migrationPoolValue,
				LabelMount:        mount,
				LabelMigrationFor: agentName,
			},
		},
		Spec: spec,
	}
	if _, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Create(ctx, pvc, metav1.CreateOptions{}); err != nil && !errors.IsAlreadyExists(err) {
		return "", fmt.Errorf("creating target PVC: %w", err)
	}
	slog.Info("storage migration: target volume created", "agent", agentName, "pvc", targetName, "size", size.String())
	return targetName, nil
}

// flip moves the agent onto its verified target volumes:
//
//  1. label each target like a claimed spare (claim recovery mounts it),
//  2. strip each source's agent/mount labels and mark it superseded,
//  3. delete the StatefulSet (already at zero replicas) so the reconciler
//     re-renders it against the new claims,
//  4. delete the superseded sources (checksum-verified copy — see file
//     comment) and the finished Job,
//  5. clear the gate and restore the agent's prior run state.
//
// Interruptible: each sub-step is an idempotent single-object write, and
// migrateAgent's no-RWX-left branch funnels a resumed run back into
// finishFlip.
func (m *StorageMigrationManager) flip(ctx context.Context, agent *apiv1.Agent, pairs []migrationPair, jobName string) error {
	name := agent.Name
	pvcClient := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace)

	for _, pair := range pairs {
		if err := patchPVCLabels(ctx, m.client, m.config.Namespace, pair.target, map[string]*string{
			LabelAgent:        ptrString(name),
			LabelMigrationFor: nil,
		}); err != nil {
			return fmt.Errorf("labeling target %s: %w", pair.target, err)
		}
		if err := patchPVCLabels(ctx, m.client, m.config.Namespace, pair.old, map[string]*string{
			LabelAgent:               nil,
			LabelMount:               nil,
			LabelMigrationSuperseded: ptrString(name),
		}); err != nil {
			return fmt.Errorf("stripping source %s: %w", pair.old, err)
		}
	}

	// The StatefulSet still references the old volume (claim decisions are
	// frozen in the live object); deleting it lets the reconciler re-render
	// against the newly-claimed target. Replicas are zero — nothing dies.
	if err := m.client.AppsV1().StatefulSets(m.config.Namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("deleting statefulset: %w", err)
	}

	list, err := pvcClient.List(ctx, metav1.ListOptions{LabelSelector: LabelMigrationSuperseded + "=" + name})
	if err != nil {
		return err
	}
	for _, p := range list.Items {
		if err := pvcClient.Delete(ctx, p.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("deleting superseded %s: %w", p.Name, err)
		}
		slog.Info("storage migration: superseded volume deleted", "agent", name, "pvc", p.Name)
	}

	prop := metav1.DeletePropagationBackground
	if err := m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, jobName, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("deleting copy job: %w", err)
	}

	return m.finishFlip(ctx, agent)
}

// finishFlip is the resumable tail of flip: sweep superseded sources, lift
// the gate, restore run state.
func (m *StorageMigrationManager) finishFlip(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	pvcClient := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace)
	list, err := pvcClient.List(ctx, metav1.ListOptions{LabelSelector: LabelMigrationSuperseded + "=" + name})
	if err != nil {
		return err
	}
	for _, p := range list.Items {
		if err := pvcClient.Delete(ctx, p.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return err
		}
	}

	patch := map[string]*string{
		annStorageMigration:           nil,
		annStorageMigrationWasRunning: nil,
	}
	if agent.Annotations[annStorageMigrationWasRunning] == "true" {
		// A fresh activity stamp wakes the pair back up through the normal
		// path — budget gate included, like any deliberate start.
		patch[annLastActivity] = ptrString(m.now().UTC().Format(time.RFC3339))
	}
	if err := m.patchAgentAnnotations(ctx, name, patch); err != nil {
		return err
	}
	slog.Info("storage migration: agent migrated to ReadWriteOnce storage", "agent", name,
		"wasRunning", agent.Annotations[annStorageMigrationWasRunning] == "true")
	return nil
}

func (m *StorageMigrationManager) agentPodPresent(ctx context.Context, agentName string) (bool, error) {
	pods, err := m.client.CoreV1().Pods(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + agentName + "," + LabelRole + "=" + RoleAgent,
	})
	if err != nil {
		return false, err
	}
	return len(pods.Items) > 0, nil
}

// patchAgentAnnotations merge-patches annotations on the Agent CR; a nil
// value deletes the key.
func (m *StorageMigrationManager) patchAgentAnnotations(ctx context.Context, name string, ann map[string]*string) error {
	entries := make([]string, 0, len(ann))
	for k, v := range ann {
		if v == nil {
			entries = append(entries, fmt.Sprintf("%q:null", k))
		} else {
			entries = append(entries, fmt.Sprintf("%q:%q", k, *v))
		}
	}
	sort.Strings(entries)
	patch := fmt.Sprintf(`{"metadata":{"annotations":{%s}}}`, strings.Join(entries, ","))
	_, err := m.dynamic.Resource(AgentsGVR).Namespace(m.config.Namespace).
		Patch(ctx, name, k8stypes.MergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}

func patchPVCLabels(ctx context.Context, client kubernetes.Interface, namespace, name string, labels map[string]*string) error {
	entries := make([]string, 0, len(labels))
	for k, v := range labels {
		if v == nil {
			entries = append(entries, fmt.Sprintf("%q:null", k))
		} else {
			entries = append(entries, fmt.Sprintf("%q:%q", k, *v))
		}
	}
	sort.Strings(entries)
	patch := fmt.Sprintf(`{"metadata":{"labels":{%s}}}`, strings.Join(entries, ","))
	_, err := client.CoreV1().PersistentVolumeClaims(namespace).
		Patch(ctx, name, k8stypes.MergePatchType, []byte(patch), metav1.PatchOptions{})
	if errors.IsNotFound(err) {
		return nil
	}
	return err
}

func ptrString(s string) *string { return &s }

func jobSucceeded(job *batchv1.Job) bool {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobComplete && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func jobFailed(job *batchv1.Job) bool {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobFailed && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

// buildMigrationJob renders the copy Job: one pod mounting every
// (source read-only, target read-write) pair, running a copy + two-pass
// checksum verification per pair.
//
// The copy runs as the AGENT's uid, unprivileged, and needs no capabilities:
// an agent's workspace is
// single-owner by construction (everything in it is written as the agent
// user), so the agent uid can read every file — including 0600 files and
// 0700 dirs — even on shared-filesystem classes that squash root, where a
// root-running copy would EACCES on the first private file. Ownership on
// the target is preserved by construction (the creator is the same uid).
// One preparation step does need root: a fresh target volume's root
// directory belongs to root (and fsGroup is skipped on hostPath-backed
// classes like local-path), so `cp -a` preserving the root's timestamps
// would EPERM as the agent uid. A root init container chowns the EMPTY
// target root to the agent uid — it mounts only targets, never the
// source, so a squashing source share never sees uid 0. The pod carries
// no serviceaccount token and no agent labels (so the pod-IP resolver,
// NetworkPolicies, and the idle checker never see it), and inherits the
// agents' scheduling policy (tolerations/selectors), which is also what
// lands the WaitForFirstConsumer target volume on a node agents can run on.
func buildMigrationJob(agentName string, pairs []migrationPair, cfg *config.Config, ownerRef metav1.OwnerReference) *batchv1.Job {
	var volumes []corev1.Volume
	var mounts []corev1.VolumeMount
	var script strings.Builder
	// The copy runs as the agent uid — resolved from the chart's container
	// security context, which is the identity the agent itself runs with.
	uid := migrationFallbackUID
	if sc := cfg.AgentBase.ContainerSecurityContext; sc != nil && sc.RunAsUser != nil {
		uid = *sc.RunAsUser
	}
	gid := int64(0)

	// The ownership preflight and the uid column of the metadata comparison
	// move together: normalizing ownership (opt-in) means the target's uids
	// legitimately differ from the source's, so comparing them would fail by
	// design. Everything else — type, mode, path, symlink target, content —
	// is verified either way.
	metaFmt := "%y|%m|%U|%p|%l"
	if cfg.StorageMigration.AllowOwnershipRemap {
		metaFmt = "%y|%m|%p|%l"
	}
	fmt.Fprintf(&script, "set -euo pipefail\nAGENT_UID=%d\nALLOW_OWNERSHIP_REMAP=%s\nMETA_FMT=%q\n",
		uid, map[bool]string{true: "1", false: "0"}[cfg.StorageMigration.AllowOwnershipRemap], metaFmt)
	script.WriteString(`
copy_verify() {
  src="$1"; dst="$2"
  echo "migrate: $src -> $dst"
  # Everything here runs as the AGENT's uid — no root, no capabilities.
  # Privilege is not available to rely on: OpenShift's restricted SCC strips
  # CAP_CHOWN/CAP_DAC_OVERRIDE (so even uid 0 cannot chown or bypass a mode),
  # and a Kata sandbox's virtiofs refuses guest-side chown outright. What the
  # agent uid always has is OWNERSHIP of the whole workspace, and an owner may
  # chmod its own entries — which is all this needs.

  # Preflight: an entry its OWNER cannot read is unreadable to every uid on a
  # root-squashing share — no copier can move it. Fail fast with the exact
  # list (the fix is chmod u+rX on the source) instead of a mid-copy error.
  # Dangling symlinks are excluded: -readable follows links, and a dangling
  # link is legitimate workspace content that the copy recreates fine.
  unreadable="$(cd "$src" && find . ! -type l ! -readable | head -20)"
  if [ -n "$unreadable" ]; then
    echo "migration blocked: owner-unreadable entries on the source (list may be truncated):"
    echo "$unreadable"
    exit 1
  fi
  echo "source size: $(du -sh "$src" | cut -f1)"

  # Ownership: an unprivileged copy recreates entries as the agent uid, so it
  # is only faithful while the workspace is single-owner — which it is by
  # construction (the agent writes its own workspace). Anything owned by
  # another uid is reported and blocks the copy rather than being silently
  # re-owned. Remedy: chown it to the agent uid on the source, or set
  # controller.storageMigration.allowOwnershipRemap to accept the
  # normalization. Privilege is not an option here: a restricted SCC strips
  # CAP_CHOWN and Kata virtiofs refuses guest chown outright.
  foreign="$(cd "$src" && find . ! -uid ${AGENT_UID} ! -path ./lost+found | head -20)"
  if [ -n "$foreign" ]; then
    if [ "${ALLOW_OWNERSHIP_REMAP}" = "1" ]; then
      echo "note: re-owning these source entries to uid ${AGENT_UID} (allowOwnershipRemap; list may be truncated):"
      echo "$foreign"
    else
      echo "migration blocked: source entries owned by another uid, which an unprivileged copy cannot reproduce (list may be truncated):"
      echo "$foreign"
      echo "remedy: chown them to uid ${AGENT_UID} on the source, or set controller.storageMigration.allowOwnershipRemap=true to accept the normalization"
      exit 1
    fi
  fi

  # Per-attempt wipe so retries are deterministic. Restoring u+rwX first is
  # what makes it possible as the owner: a prior attempt faithfully
  # reproduced the workspace's read-only directories (0500/0555 — Go module
  # caches, site-packages), and removing an entry needs write+execute on its
  # parent. LOST+FOUND is skipped: it is a fresh ext4 volume's own artifact,
  # root-owned and not ours to delete — the verification excludes it too.
  find "$dst" -mindepth 1 -maxdepth 1 ! -name lost+found -exec chmod -R u+rwX {} +
  find "$dst" -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} +

  # tar, not "cp -a src/. dst/": cp applies the SOURCE ROOT's ownership and
  # timestamps to the TARGET ROOT, which no unprivileged process can do (the
  # root belongs to the provisioner; fsGroup, not us, makes it writable).
  # --no-overwrite-dir leaves the target root's own metadata alone; -p keeps
  # every mode including setuid; tar preserves hard links natively (a
  # hard-link-heavy pnpm store must not inflate past the volume size) and
  # --sparse keeps sparse files sparse. Ownership needs no preserving: the
  # workspace has a single owner and we are it.
  tar -C "$src" --sparse -cf - . | tar -C "$dst" -xpf - --no-overwrite-dir
  sync

  # The target root must be writable by the agent — the property the copy
  # cannot assert for itself (its mode belongs to the provisioner/fsGroup,
  # so comparing it against the source root would fail spuriously).
  touch "$dst/.migration-writable" && rm -f "$dst/.migration-writable"

  # Two-pass verification against the quiesced source; the old volume is
  # deleted at flip on the strength of these comparisons, so both fail
  # closed on any difference.
  #
  # Pass 1 — metadata: type, mode, owner uid, path, and symlink target for
  # every entry. A mode that failed to carry over blocks the migration just
  # like corrupt content would. Deliberate exclusions: gid (agent images run
  # uid:0, while an fsGroup-managed target assigns its own gid — group
  # identity is not part of the workspace contract), the volume root itself,
  # and lost+found.
  meta() { (cd "$1" && find . -mindepth 1 ! -path ./lost+found -printf "${META_FMT}\n" | LC_ALL=C sort); }
  meta "$src" > /tmp/src.meta
  meta "$dst" > /tmp/dst.meta
  cmp /tmp/src.meta /tmp/dst.meta
  # Pass 2 — content checksums. md5 is deliberate: this is integrity
  # checking of our own quiesced copy, not defense against an adversary
  # crafting collisions — and it is the fastest digest coreutils ships.
  sums() { (cd "$1" && find . -type f ! -path ./lost+found/\* -print0 | LC_ALL=C sort -z | xargs -0 -r md5sum); }
  sums "$src" > /tmp/src.sum
  sums "$dst" > /tmp/dst.sum
  cmp /tmp/src.sum /tmp/dst.sum
  echo "verified (content + metadata): $src -> $dst"
}
`)
	for i, pair := range pairs {
		srcVol := fmt.Sprintf("src-%d", i)
		dstVol := fmt.Sprintf("dst-%d", i)
		volumes = append(volumes,
			corev1.Volume{
				Name: srcVol,
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pair.old, ReadOnly: true},
				},
			},
			corev1.Volume{
				Name: dstVol,
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pair.target},
				},
			},
		)
		mounts = append(mounts,
			corev1.VolumeMount{Name: srcVol, MountPath: fmt.Sprintf("/mnt/src-%d", i), ReadOnly: true},
			corev1.VolumeMount{Name: dstVol, MountPath: fmt.Sprintf("/mnt/dst-%d", i)},
		)
		fmt.Fprintf(&script, "copy_verify /mnt/src-%d /mnt/dst-%d\n", i, i)
	}

	backoff := int32(2)
	ttl := int32(600)
	deadline := int64(migrationJobDeadline.Seconds())
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:            migrationJobName(agentName),
			Namespace:       cfg.Namespace,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
			Labels: map[string]string{
				LabelMigrationFor:              agentName,
				"agent-platform.ai/managed-by": "platform-controller",
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			ActiveDeadlineSeconds:   &deadline,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						LabelMigrationFor:              agentName,
						"agent-platform.ai/managed-by": "platform-controller",
						// No mesh, no gateway: the pod needs no network at all.
						"istio.io/dataplane-mode": "none",
					},
				},
				Spec: corev1.PodSpec{
					// Never, not OnFailure: an in-place container restart
					// would skip the init containers, and every attempt
					// needs the root init's wipe first. With Never each
					// retry is a fresh pod (BackoffLimit still bounds them).
					RestartPolicy:                corev1.RestartPolicyNever,
					AutomountServiceAccountToken: ptrBool(false),
					SecurityContext: &corev1.PodSecurityContext{
						RunAsUser: &uid,
						// Group 0, matching the agent images' own uid:0
						// convention, so anything the copy creates carries
						// the identity the agent itself runs with.
						RunAsGroup: &gid,
						// fsGroup covers CSI block backends; hostPath-backed
						// classes (local-path) skip it, which is what the
						// chown init container below is for.
						FSGroup: &uid,
					},
					Containers: []corev1.Container{{
						Name:         "copy",
						Image:        cfg.StorageMigration.JobImage,
						Command:      []string{"bash", "-c", script.String()},
						VolumeMounts: mounts,
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("100m"),
								corev1.ResourceMemory: resource.MustParse("128Mi"),
							},
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("1"),
								corev1.ResourceMemory: resource.MustParse("512Mi"),
							},
						},
					}},
					Volumes: volumes,
				},
			},
		},
	}
	// Scheduling (nodeSelector/tolerations/affinity) is inherited so the
	// target volume binds where agents actually run — but the runtime class
	// is deliberately dropped. The agents' class is Kata on some installs,
	// whose virtiofs-backed mounts refuse guest-side chown and give no
	// guarantee about hard-link or sparse fidelity; this pod runs only
	// platform tooling over the agent's data, never agent code, so the VM
	// isolation buys nothing and costs correctness plus a VM boot per copy.
	applyAgentBaseScheduling(&job.Spec.Template.Spec, cfg.AgentBase)
	job.Spec.Template.Spec.RuntimeClassName = nil
	return job
}
