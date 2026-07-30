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
	storagev1 "k8s.io/api/storage/v1"
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
	// migrationFallbackGID pairs with migrationFallbackUID when the chart
	// pins no group; the platform images run 65532:65532.
	migrationFallbackGID = int64(65532)
	// migrationChecksumParallelism is how many md5sum workers read the tree
	// at once. Small-file verification over a network filesystem is bound by
	// per-file round-trips, not bandwidth or CPU, so concurrency buys close
	// to linear speedup; 8 keeps well inside an IOPS-capped share's budget.
	migrationChecksumParallelism = 8
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
	// per process, not once per tick. warnedSameClass and loggedReason do the
	// same for the misconfigured-target refusal and the per-agent reason.
	skippedVM       map[string]bool
	warnedSameClass map[string]bool
	loggedReason    map[string]bool
	warnedResolve   bool
}

func NewStorageMigrationManager(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *StorageMigrationManager {
	return &StorageMigrationManager{
		client:          client,
		dynamic:         dyn,
		config:          cfg,
		now:             time.Now,
		skippedVM:       map[string]bool{},
		warnedSameClass: map[string]bool{},
		loggedReason:    map[string]bool{},
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
	// "Source still present" — by the same rule Reconcile admits work with,
	// so a workspace pending only a storage-class move is recognised as an
	// un-flipped source rather than mistaken for a completed migration.
	targetClass, _ := m.resolveTargetClass(ctx)
	allowSame := m.config.StorageMigration.AllowSameStorageClass
	rwx := map[string]bool{}
	if pvcs, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent,
	}); err == nil {
		for i := range pvcs.Items {
			p := pvcs.Items[i]
			if _, needed := migrationReason(&p, targetClass, allowSame); needed {
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

	targetClass, explicitClass := m.resolveTargetClass(ctx)
	allowSame := m.config.StorageMigration.AllowSameStorageClass

	// Agents whose workspace volume is on the wrong access mode or the wrong
	// storage class, plus agents already gated (annotation set) whose source
	// may already be stripped — the union is the resumable work list.
	rwxByAgent := map[string][]corev1.PersistentVolumeClaim{}
	for i := range pvcs.Items {
		p := pvcs.Items[i]
		reason, needed := migrationReason(&p, targetClass, allowSame)
		agent := p.Labels[LabelAgent]
		if !needed {
			// Distinguish "nothing to do" from "refused": a shared-writable
			// volume already sitting on the target class means the target is
			// the shared filesystem itself, which the migration exists to
			// leave. Say so, once per agent per process.
			if isRWX(p.Spec.AccessModes) && !m.warnedSameClass[agent] {
				m.warnedSameClass[agent] = true
				slog.Warn("storage migration: refusing to migrate onto the volume's own storage class — the access mode would change but the backend would not",
					"agent", agent, "pvc", p.Name, "class", targetClass,
					"remedy", "set controller.storageMigration.targetStorageClass to the class agents should end on (empty = cluster default), or allowSameStorageClass=true if this is intended")
			}
			continue
		}
		if !m.loggedReason[agent] {
			m.loggedReason[agent] = true
			slog.Info("storage migration: workspace needs migrating", "agent", agent, "pvc", p.Name,
				"reason", reason, "target", map[bool]string{true: targetClass, false: targetClass + " (cluster default)"}[explicitClass])
		}
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
		if err := m.migrateAgent(ctx, agent, rwxByAgent[name], targetClass); err != nil {
			slog.Warn("storage migration: agent migration step failed", "agent", name, "error", err)
		}
	}
}

// resolveTargetClass returns the storage class migrated workspaces land on,
// and whether the chart named it explicitly. Empty-and-inexplicit means the
// cluster default: the target PVC then omits storageClassName so ordinary
// default storage applies, while the resolved NAME is still needed to tell a
// workspace that has already arrived from one that has not.
//
// Deliberately independent of AgentBase.StorageClass: on an install that has
// not migrated yet, that value still names the shared filesystem being
// drained, so inheriting it would copy every byte to reach the same backend.
func (m *StorageMigrationManager) resolveTargetClass(ctx context.Context) (name string, explicit bool) {
	if c := m.config.StorageMigration.TargetStorageClass; c != "" {
		return c, true
	}
	classes, err := m.client.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		// Without the default class's name the class comparison can't run;
		// the RWX rule still does, so the drain degrades rather than stops.
		m.warnResolveOnce("storage migration: cannot resolve the cluster default storage class; migrating on access mode only", err)
		return "", false
	}
	// Same tie-break as the DefaultStorageClass admission plugin: with
	// several classes annotated default, the NEWEST wins. Diverging from
	// admission here would discard-and-recreate targets forever — admission
	// stamps one class, this comparison expects another.
	var picked *storagev1.StorageClass
	for i := range classes.Items {
		sc := &classes.Items[i]
		if sc.Annotations["storageclass.kubernetes.io/is-default-class"] != "true" {
			continue
		}
		if picked == nil || sc.CreationTimestamp.After(picked.CreationTimestamp.Time) {
			picked = sc
		}
	}
	if picked != nil {
		return picked.Name, false
	}
	m.warnResolveOnce("storage migration: no default storage class found; migrating on access mode only", nil)
	return "", false
}

// warnResolveOnce keeps the per-tick resolution warnings from repeating every
// 30s for the lifetime of a misconfigured install.
func (m *StorageMigrationManager) warnResolveOnce(msg string, err error) {
	if m.warnedResolve {
		return
	}
	m.warnedResolve = true
	if err != nil {
		slog.Warn(msg, "error", err)
		return
	}
	slog.Warn(msg)
}

// migrationReason says why a workspace needs migrating, or "" if it does not.
// Two triggers: a shared-writable access mode, and sitting on the wrong
// storage class — the second is what moves a workspace that was already
// flipped to ReadWriteOnce but left on the shared filesystem.
func migrationReason(pvc *corev1.PersistentVolumeClaim, targetClass string, allowSame bool) (string, bool) {
	srcClass := ""
	if pvc.Spec.StorageClassName != nil {
		srcClass = *pvc.Spec.StorageClassName
	}
	sameClass := targetClass != "" && srcClass == targetClass
	if isRWX(pvc.Spec.AccessModes) {
		if sameClass && !allowSame {
			// Refuse rather than drain a fleet to no purpose: the operator
			// has pointed the migration at the very filesystem it exists to
			// leave. Changing the access mode alone buys nothing.
			return "", false
		}
		return "shared-writable access mode", true
	}
	// Already single-writer: only the destination is left to fix. A volume
	// with no class at all is left alone — it is statically provisioned, and
	// "converge it onto the default class" is not a call this should make.
	if targetClass != "" && srcClass != "" && srcClass != targetClass {
		return "storage class " + srcClass + " is not the migration target " + targetClass, true
	}
	return "", false
}

// targetReusable says whether an existing, unclaimed migration target may
// receive this configuration's copy. Class must match the resolved
// destination (unknown destination — lookup failed — accepts anything rather
// than churn), and the size must meet the configured floor so a floor added
// after a failed attempt takes effect on the retry.
func (m *StorageMigrationManager) targetReusable(existing *corev1.PersistentVolumeClaim, targetClass string) bool {
	if targetClass != "" && ptrClassString(existing.Spec.StorageClassName) != targetClass {
		return false
	}
	if floor := m.config.StorageMigration.MinTargetSize; floor != "" {
		if q, err := resource.ParseQuantity(floor); err == nil {
			if size := existing.Spec.Resources.Requests[corev1.ResourceStorage]; size.Cmp(q) < 0 {
				return false
			}
		}
	}
	return true
}

func ptrClassString(sc *string) string {
	if sc == nil {
		return ""
	}
	return *sc
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
func (m *StorageMigrationManager) migrateAgent(ctx context.Context, agent *apiv1.Agent, rwxPVCs []corev1.PersistentVolumeClaim, targetClass string) error {
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
			target, err := m.ensureTargetPVC(ctx, name, mount, &old, ownerRef, targetClass)
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
func (m *StorageMigrationManager) ensureTargetPVC(ctx context.Context, agentName, mount string, old *corev1.PersistentVolumeClaim, ownerRef metav1.OwnerReference, targetClass string) (string, error) {
	targetName := migrationTargetName(old.Name)
	existing, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Get(ctx, targetName, metav1.GetOptions{})
	if err == nil {
		// A pre-existing target is only reusable if it is where THIS
		// configuration wants the data to land. The wrong-class incident
		// left exactly the counterexample behind: targets provisioned on
		// the shared-filesystem class by the old inherit-the-agents'-class
		// bug — reusing one would copy every byte straight back onto the
		// backend being drained, silently defeating a corrected config.
		if existing.DeletionTimestamp != nil {
			return "", fmt.Errorf("stale migration target %s is still terminating; retrying next tick", targetName)
		}
		if m.targetReusable(existing, targetClass) {
			return targetName, nil
		}
		// Refuse to touch anything claimed: LabelAgent appears on the
		// target only at flip, when it becomes the agent's LIVE volume.
		// An unclaimed target is garbage by construction — but if this
		// ever disagrees, erring on "migration stalls" beats "volume
		// deleted".
		if existing.Labels[LabelAgent] != "" {
			return "", fmt.Errorf("target %s does not match the configured destination but is already claimed; refusing to replace it", targetName)
		}
		slog.Warn("storage migration: discarding stale target provisioned for a different destination",
			"agent", agentName, "pvc", targetName,
			"have", ptrClassString(existing.Spec.StorageClassName), "want", targetClass)
		// The copy Job (if any) mounts the stale target by name; it must go
		// first or pvc-protection pins the PVC until the pod exits anyway.
		prop := metav1.DeletePropagationBackground
		if err := m.client.BatchV1().Jobs(m.config.Namespace).Delete(ctx, migrationJobName(agentName),
			metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !errors.IsNotFound(err) {
			return "", err
		}
		if err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Delete(ctx, targetName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return "", err
		}
		return "", fmt.Errorf("discarded stale migration target %s; recreating next tick", targetName)
	}
	if !errors.IsNotFound(err) {
		return "", err
	}

	size := old.Spec.Resources.Requests[corev1.ResourceStorage]
	if size.IsZero() {
		size = resource.MustParse(m.config.AgentTemplateDefaults.StorageSize)
	}
	// Floor the request where the target class ties IOPS to capacity: a
	// faithfully-sized small volume would inherit a proportionally tiny IOPS
	// budget and make the copy — which is per-file bound — crawl.
	if floor := m.config.StorageMigration.MinTargetSize; floor != "" {
		if q, err := resource.ParseQuantity(floor); err != nil {
			slog.Warn("storage migration: minTargetSize is not a valid quantity; ignoring", "value", floor, "error", err)
		} else if size.Cmp(q) < 0 {
			slog.Info("storage migration: raising target size to the configured floor",
				"agent", agentName, "requested", size.String(), "floor", q.String())
			size = q
		}
	}
	spec := corev1.PersistentVolumeClaimSpec{
		AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
		Resources: corev1.VolumeResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceStorage: size},
		},
	}
	// The migration's own destination — NOT AgentBase.StorageClass, which on
	// an unmigrated install still names the shared filesystem being drained.
	// Left unset when the chart names no class, so the cluster default
	// applies exactly as it would for any ordinary PVC.
	if sc := m.config.StorageMigration.TargetStorageClass; sc != "" {
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
// The copy runs as the AGENT's uid, unprivileged and needing no
// capabilities: an agent's workspace is single-owner by construction
// (everything in it is written as the agent user), so the agent uid can
// read every file — including 0600 files and
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
	// The copy runs as the agent's own uid AND gid, resolved from the chart's
	// container security context — the identity the agent itself runs with,
	// so what the copy creates is what the agent can use.
	uid, gid := migrationFallbackUID, migrationFallbackGID
	if sc := cfg.AgentBase.ContainerSecurityContext; sc != nil {
		if sc.RunAsUser != nil {
			uid = *sc.RunAsUser
		}
		if sc.RunAsGroup != nil {
			gid = *sc.RunAsGroup
		}
	}

	// The walk always emits flag|type|mode|uid|path|link; what the comparison
	// KEEPS is a cut of that. Normalizing ownership (opt-in) means the
	// target's uids legitimately differ from the source's, so the uid column
	// drops out — everything else stays verified either way.
	metaCut := "2-"
	if cfg.StorageMigration.AllowOwnershipRemap {
		metaCut = "2,3,5,6"
	}
	fmt.Fprintf(&script, "set -euo pipefail\nAGENT_UID=%d\nALLOW_OWNERSHIP_REMAP=%s\nMETA_CUT=%s\nPAR=%d\n",
		uid, map[bool]string{true: "1", false: "0"}[cfg.StorageMigration.AllowOwnershipRemap], metaCut, migrationChecksumParallelism)
	script.WriteString(`
T0=$(date +%s)
phase() { echo "phase: $1 (+$(( $(date +%s) - T0 ))s)"; }

copy_verify() {
  src="$1"; dst="$2"
  echo "migrate: $src -> $dst"

  # ONE walk of the source, and every check below is derived from its output.
  # This is the difference between minutes and hours: a workspace is
  # small-file-heavy (a pnpm store is 100k+ entries), every stat is a network
  # round-trip AND an IOP against a capped share, so each extra walk costs
  # the whole tree again. The source is quiesced, so one walk is also
  # sufficient — nothing can change under us.
  #
  # The readability flag rides the same pass: find evaluates -readable per
  # entry and the alternation picks the prefix. The inner group is what keeps
  # the -o from swallowing the -mindepth/-path filters.
  # -prune on the root lost+found, never ! -path: exclusion by path still
  # DESCENDS into the directory, and a 0700 root-owned one aborts the walk
  # with permission denied. Anchored (./lost+found, no glob) so a nested
  # one the workspace legitimately owns is still inventoried.
  (cd "$src" && find . -mindepth 1 \( -path ./lost+found -prune \) -o \
     \( \( -readable -printf "r|%y|%m|%U|%p|%l\n" \) -o -printf "x|%y|%m|%U|%p|%l\n" \) \
   ) > /tmp/src.walk
  entries=$(wc -l < /tmp/src.walk)
  phase "walked source: $entries entries"

  # Unreadable to its own OWNER is unreadable to every uid on a
  # root-squashing share — no copier can move it, so fail with the paths
  # rather than a mid-copy error. Symlinks are exempt: -readable follows the
  # link, and a dangling link is legitimate content the copy recreates.
  # The 20-line cap lives INSIDE awk: piping through head under pipefail
  # means awk dies of SIGPIPE once head exits, and set -e then kills the
  # script before the diagnostic prints — a cryptic 141 instead of paths.
  unreadable="$(awk -F'|' '$1=="x" && $2!="l" && n<20 {print $5; n++}' /tmp/src.walk)"
  if [ -n "$unreadable" ]; then
    echo "migration blocked: owner-unreadable entries on the source (list may be truncated):"
    echo "$unreadable"
    exit 1
  fi

  # Ownership: an unprivileged copy recreates entries as the agent uid, so it
  # is only faithful while the workspace is single-owner — which it is by
  # construction. Anything else is reported rather than silently re-owned.
  foreign="$(awk -F'|' -v u="${AGENT_UID}" '$4!=u && n<20 {print $5; n++}' /tmp/src.walk)"
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

  # The same walk is the verification baseline — cut drops the readability
  # flag (and the uid column when ownership is being normalized), and the
  # sort happens after the cut so both sides order identically.
  #
  # dirmask strips the setgid bit from DIRECTORY modes on both sides
  # before comparing. fsGroup marks the target volume root setgid (that is
  # how the volume group reaches new entries) and every directory the copy
  # creates inherits the bit at mkdir time, underneath tar — so target
  # dirs read 2xxx where the source says xxx on every real CSI block
  # target (invisible on hostPath dev classes, which skip fsGroup).
  # Group identity is already outside the workspace contract — gid is
  # excluded from this comparison for the same reason — and setgid on a
  # directory governs nothing but group inheritance, so the bit is masked
  # rather than the filesystem mutated: the migrated tree deliberately
  # KEEPS inheriting the volume group for files the agent creates later,
  # since agent pods set no fsGroup of their own. File modes stay strict.
  dirmask() { awk -F'|' 'BEGIN{OFS="|"} $1=="d" && length($2)==4 {d=substr($2,1,1); if (d%4>=2) { d-=2; $2=(d==0) ? substr($2,2) : d substr($2,2) } } {print}'; }
  cut -d'|' -f${META_CUT} /tmp/src.walk | dirmask | LC_ALL=C sort > /tmp/src.meta

  # Per-attempt wipe so retries are deterministic. Restoring u+rwX first is
  # what makes it possible as the owner: a prior attempt faithfully
  # reproduced the workspace's read-only directories (0500/0555 — Go module
  # caches, site-packages), and removing an entry needs write+execute on its
  # parent. LOST+FOUND is skipped: a fresh ext4 volume's own artifact,
  # root-owned and not ours to delete — the verification excludes it too.
  # Symlinks are excluded from the mode restore: chmod dereferences a
  # top-level link argument, and a DANGLING one (legitimate content) would
  # error out and wedge every retry. rm -rf removes links themselves fine.
  find "$dst" -mindepth 1 -maxdepth 1 ! -name lost+found ! -type l -exec chmod -R u+rwX {} +
  find "$dst" -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} +
  phase "wiped target"

  # Archive the source's CONTENTS, never the source directory itself. An
  # archive containing "./" carries the source root's mode, and tar applies
  # it to the target root on extraction — which fails as EPERM, because the
  # target root belongs to the provisioner (fsGroup makes it writable to us,
  # it does not make us its owner). --no-overwrite-dir does not save us:
  # tar's delayed directory restore still stats and chmods that member at
  # the end of extraction. Feeding tar the top-level entries sidesteps it
  # entirely — the root is never a member, so its metadata is never touched.
  # One tar process still sees the whole tree, so hard links are preserved
  # (a hard-link-heavy pnpm store must not inflate past the volume size);
  # -p keeps every mode including setuid, --sparse keeps sparse files
  # sparse, and ownership needs no preserving because the workspace has a
  # single owner and we are it.
  if [ "$entries" -gt 0 ]; then
    (cd "$src" && find . -mindepth 1 -maxdepth 1 ! -path './lost+found*' -print0) \
      | tar -C "$src" --sparse --null -T - -cf - \
      | tar -C "$dst" -xpf - --no-overwrite-dir
    sync
  else
    echo "source is empty; nothing to copy"
  fi
  phase "copied"

  # The target root must be writable by the agent — the property the copy
  # cannot assert for itself (its mode belongs to the provisioner/fsGroup,
  # so comparing it against the source root would fail spuriously).
  touch "$dst/.migration-writable" && rm -f "$dst/.migration-writable"

  # Two-pass verification against the quiesced source; the old volume is
  # deleted at flip on the strength of these comparisons, so both fail
  # closed on any difference.
  #
  # Pass 1 — metadata: type, mode, owner uid, path and symlink target for
  # every entry. A mode that failed to carry over blocks the migration just
  # like corrupt content would. Deliberate exclusions: gid (agent images run
  # uid:0 while an fsGroup-managed target assigns its own gid — group
  # identity is not part of the workspace contract), the volume root itself,
  # and lost+found.
  (cd "$dst" && find . -mindepth 1 \( -path ./lost+found -prune \) -o -printf "d|%y|%m|%U|%p|%l\n") \
    | cut -d'|' -f${META_CUT} | dirmask | LC_ALL=C sort > /tmp/dst.meta
  cmp /tmp/src.meta /tmp/dst.meta
  phase "verified metadata"

  # Pass 2 — content checksums, read in parallel: this is latency-bound, not
  # CPU-bound, so workers overlap round-trips instead of queueing behind each
  # other. Output is sorted after collection because workers finish out of
  # order. md5 is deliberate: integrity checking of our own quiesced copy,
  # not defense against crafted collisions — and the fastest digest coreutils
  # ships.
  # Each worker batch writes its own file: with a shared stdout, a batch
  # whose output exceeds one atomic pipe write (long node_modules paths
  # easily do) can interleave mid-line with another worker, and a torn line
  # is a spurious verification failure. O_APPEND to distinct files by PID
  # cannot tear.
  sums() {
    rm -f /tmp/sums.*
    (cd "$1" && find . \( -path ./lost+found -prune \) -o -type f -print0 \
       | xargs -0 -r -P"${PAR}" -n64 sh -c 'md5sum "$@" >> "/tmp/sums.$$"' _)
    cat /tmp/sums.* 2>/dev/null | LC_ALL=C sort
  }
  sums "$src" > /tmp/src.sum
  sums "$dst" > /tmp/dst.sum
  cmp /tmp/src.sum /tmp/dst.sum
  phase "verified content"
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
						RunAsUser:  &uid,
						RunAsGroup: &gid,
						// fsGroup is the AGENT's group, and that is
						// load-bearing beyond this Job: the kubelet chowns a
						// fresh volume's root to it and adds group-write, and
						// that chown persists on the filesystem. Agent pods
						// set no fsGroup of their own, so this is what leaves
						// the migrated root writable to the agent afterwards.
						// (hostPath-backed classes skip fsGroup; their roots
						// are world-writable already.)
						FSGroup: &gid,
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
