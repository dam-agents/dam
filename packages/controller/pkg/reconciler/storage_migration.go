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
	defaultMigrationConcurrency = 2
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

// RunLoop reconciles until ctx is done. A no-op ticker when disabled.
func (m *StorageMigrationManager) RunLoop(ctx context.Context) {
	if !m.config.StorageMigration.Enabled {
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
// The copy runs as the AGENT's uid, not root: an agent's workspace is
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
	script.WriteString(`set -eu
copy_verify() {
  src="$1"; dst="$2"
  echo "migrate: $src -> $dst"
  # The target arrives EMPTY: the root init container wipes it before every
  # attempt (restartPolicy Never makes each attempt a fresh pod, so the init
  # re-runs). The cleanup cannot live here — the agent uid can neither
  # descend into a root-owned lost+found (ext4 block volumes) nor delete
  # inside the read-only dirs (0500/0555: Go module caches, site-packages)
  # that a prior attempt's cp -a faithfully reproduced.
  # GNU cp -a: permissions, ownership, times, symlinks, AND hard links —
  # hard-link-heavy stores (pnpm) must not inflate past the volume size.
  cp -a "$src/." "$dst/"
  sync
  # Two-pass verification against the quiesced source: the inventory
  # (files, symlinks, and directories — so a missing empty dir is caught),
  # then content checksums. md5 is deliberate: this is integrity checking
  # of our own quiesced copy, not defense against an adversary crafting
  # collisions — and it is the fastest digest coreutils ships. The old
  # volume is deleted at flip on the strength of this comparison.
  (cd "$src" && find . \( -type f -o -type l -o -type d \) | LC_ALL=C sort) > /tmp/src.list
  (cd "$dst" && find . \( -type f -o -type l -o -type d \) | LC_ALL=C sort) > /tmp/dst.list
  cmp /tmp/src.list /tmp/dst.list
  (cd "$src" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r md5sum) > /tmp/src.sum
  (cd "$dst" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r md5sum) > /tmp/dst.sum
  cmp /tmp/src.sum /tmp/dst.sum
  echo "verified: $src -> $dst"
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
	uid := migrationFallbackUID
	if sc := cfg.AgentBase.ContainerSecurityContext; sc != nil && sc.RunAsUser != nil {
		uid = *sc.RunAsUser
	}
	root := int64(0)
	var dstMounts []corev1.VolumeMount
	var prep strings.Builder
	prep.WriteString("set -eu\n")
	for _, mnt := range mounts {
		if mnt.ReadOnly {
			continue
		}
		dstMounts = append(dstMounts, mnt)
		// Root does the wipe: a retry's target holds the prior attempt's
		// tree — including faithfully-copied read-only directories — and
		// ext4 block volumes ship a root-owned lost+found; both are
		// undeletable as the agent uid. Then hand the empty root to the
		// agent uid so the copy can preserve its attributes.
		fmt.Fprintf(&prep, "find %s -mindepth 1 -delete\n", mnt.MountPath)
		fmt.Fprintf(&prep, "chown %d:%d %s\n", uid, uid, mnt.MountPath)
	}
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
						RunAsGroup: &uid,
						// fsGroup covers CSI block backends; hostPath-backed
						// classes (local-path) skip it, which is what the
						// chown init container below is for.
						FSGroup: &uid,
					},
					InitContainers: []corev1.Container{{
						// Root touches ONLY the empty targets (see the file
						// comment): the source — possibly a root-squashing
						// share — is not even mounted here.
						Name:            "prep-target",
						Image:           cfg.StorageMigration.JobImage,
						Command:         []string{"sh", "-c", prep.String()},
						VolumeMounts:    dstMounts,
						SecurityContext: &corev1.SecurityContext{RunAsUser: &root, RunAsGroup: &root},
					}},
					Containers: []corev1.Container{{
						Name:         "copy",
						Image:        cfg.StorageMigration.JobImage,
						Command:      []string{"sh", "-c", script.String()},
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
	applyAgentBaseScheduling(&job.Spec.Template.Spec, cfg.AgentBase)
	return job
}
