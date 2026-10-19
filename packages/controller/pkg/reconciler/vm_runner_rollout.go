package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
)

const (
	annRunnerTemplate = "agent-platform.ai/runner-template"
	annRunnerRolledAt = "agent-platform.ai/runner-rolled-at"
	annRunnerAwaiting = "agent-platform.ai/runner-awaiting"
	annRunnerStalled  = "agent-platform.ai/runner-roll-stalled"
	annRunnerBusy     = "agent-platform.ai/runner-busy-since"
	// UNIT_BOUNDARY_DESCRIPTION: since when the owner's runner has said it cannot reach the node's image cache, recorded on the Deployment so the wait is judged across passes and a controller restart does not start it over.
	annRunnerCacheDown = "agent-platform.ai/runner-cache-down-since"

	// UNIT_BOUNDARY_DESCRIPTION: the reasons of the Events the roll writes on a runner, so a reader of `kubectl get events` follows a held roll and the three ways out of it without reading the controller's log.
	reasonRollHeldForIdle           = "RunnerRollHeldForIdle"
	reasonRollHeldForCache          = "RunnerRollHeldForCache"
	reasonRollIdleWaitOver          = "RunnerRollIdleWaitOver"
	reasonRollImageCacheUnreachable = "RunnerImageCacheUnreachable"

	defaultRunnerSettleTimeout = 10 * time.Minute
	defaultRunnerIdleWait      = 24 * time.Hour

	// UNIT_BOUNDARY_DESCRIPTION: how long a runner must report the unreachable cache before its roll skips the idle wait. A cache service restarted, or a socket rebound under it, refuses a connect for seconds; skipping the wait on that one answer would end the turns of a healthy, busy runner for a fault that repairs itself. A minute covers a restart of the node's service several times over, and the whole idle wait is a day, so a cache that is truly gone waits a minute and no more.
	defaultRunnerCacheDownGrace = time.Minute

	// UNIT_BOUNDARY_DESCRIPTION: how long the list of runners mid-roll is reused. The rollout sweep offers every runner its turn, and each turn asks which others are mid-roll; listing every runner Deployment on every turn is quadratic in owners. A roll this controller starts is added to the kept list at once, so the width still holds; what can be late is only a roll settling, by this much.
	runnerRollViewTTL = 10 * time.Second
)

type runnerRollView struct {
	at      time.Time
	rolling []string
}

func runnerTemplateHash(spec appsv1.DeploymentSpec) (string, error) {
	raw, err := json.Marshal(spec)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:8]), nil
}

func runnerRolloutLimits(spec config.VMRunnerSpec) (int, time.Duration) {
	limit, timeout := spec.Rollout.MaxConcurrent, spec.Rollout.SettleTimeout.AsDuration()
	if limit <= 0 {
		limit = 1
	}
	if timeout <= 0 {
		timeout = defaultRunnerSettleTimeout
	}
	return limit, timeout
}

// UNIT_BOUNDARY_DESCRIPTION: a runner's machines are its processes, so every change to its pod reboots every machine the owner has. Applied as it is rendered, one runner image bump or one controller release that renders the pod differently would reboot every vm machine in the install at the same moment. So a runner is created at once, and left alone while what it would be rendered as is what it was, but a changed pod waits for a free place in the roll: at most `rollout.maxConcurrent` runners are mid-roll at once, and a runner stays mid-roll until its new pod is ready and every machine that was ready before the roll is ready again. The rendered spec is hashed onto the Deployment, because the stored spec carries the API server's defaults and never equals the rendered one. A new runner image alone is not a changed pod (runnerRollSpec): the pod's loader takes it in place, and the pod rolls only for a release its loader can never take.
// UNIT_BOUNDARY_DESCRIPTION: a reconcile reads the Deployment from the cache first. A cache that is behind sends a create for a Deployment that exists or an update from an old resourceVersion, and the API server refuses both, so the roll is then decided again from a live read. The rollout sweep, the one caller that never creates, reads live: it first runs before the caches sync, and a runner it cannot see is skipped until the next sweep.
func (r *AgentReconciler) rollRunnerDeployment(ctx context.Context, owner string, dep *appsv1.Deployment, create bool) error {
	err := r.rollRunnerDeploymentFrom(ctx, owner, dep, create, create)
	if r.runnerDeploys != nil && (k8serrors.IsConflict(err) || k8serrors.IsAlreadyExists(err)) {
		err = r.rollRunnerDeploymentFrom(ctx, owner, dep, create, false)
	}
	return err
}

func (r *AgentReconciler) rollRunnerDeploymentFrom(ctx context.Context, owner string, dep *appsv1.Deployment, create, fromCache bool) error {
	hash, err := runnerTemplateHash(runnerRollSpec(dep.Spec))
	if err != nil {
		return err
	}
	cli := r.client.AppsV1().Deployments(dep.Namespace)
	existing, err := r.runnerDeployment(ctx, dep.Name, fromCache)
	if k8serrors.IsNotFound(err) {
		if !create {
			return nil
		}
		dep.Annotations = map[string]string{annRunnerTemplate: hash}
		_, err = cli.Create(ctx, dep, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	if existing.DeletionTimestamp != nil {
		return errRunnerTerminating
	}
	if stored := existing.Annotations[annRunnerTemplate]; stored != "" && stored != hash && stored == legacyRunnerTemplateHash(dep.Spec, existing.Spec) {
		existing.Annotations[annRunnerTemplate] = hash
		updated, err := cli.Update(ctx, existing, metav1.UpdateOptions{})
		if err != nil {
			return err
		}
		if r.runnerDeploys != nil {
			r.runnerDeploys.Mutation(updated)
		}
		existing = updated
	}
	existing = r.settleRunnerRoll(ctx, owner, existing)
	if existing.Annotations[annRunnerTemplate] == hash && !r.runnerNeedsPodForRelease(ctx, owner, existing) {
		return r.repairRunnerDeploymentMeta(ctx, owner, existing, dep)
	}

	const waiting = "vm runner: the pod changed, waiting for other runners to finish rolling"
	r.runnerRollMu.Lock()
	_, free, err := r.runnerRollPlace(ctx, owner, dep.Name, waiting)
	r.runnerRollMu.Unlock()
	if err != nil || !free {
		return err
	}
	if r.runnerRollWaitsForIdle(ctx, owner, existing) {
		return nil
	}
	ready := r.readyMachines(ctx, owner)
	r.runnerRollMu.Lock()
	defer r.runnerRollMu.Unlock()
	rolling, free, err := r.runnerRollPlace(ctx, owner, dep.Name, waiting)
	if err != nil || !free {
		return err
	}
	dep.Annotations = map[string]string{}
	for k, v := range existing.Annotations {
		dep.Annotations[k] = v
	}
	delete(dep.Annotations, annRunnerAwaiting)
	delete(dep.Annotations, annRunnerStalled)
	delete(dep.Annotations, annRunnerBusy)
	for _, ann := range []string{annRunnerRelease, annRunnerReleaseNamedAt, annRunnerHandoffAt, annRunnerHandoffAwaiting, annRunnerHandoffStalled} {
		delete(dep.Annotations, ann)
	}
	dep.Annotations[annRunnerTemplate] = hash
	dep.Annotations[annRunnerRolledAt] = time.Now().UTC().Format(time.RFC3339)
	if len(ready) > 0 {
		dep.Annotations[annRunnerAwaiting] = strings.Join(ready, ",")
	}
	dep.ResourceVersion, dep.Status = existing.ResourceVersion, existing.Status
	updated, err := cli.Update(ctx, dep, metav1.UpdateOptions{})
	if err != nil {
		return err
	}
	if r.runnerDeploys != nil {
		r.runnerDeploys.Mutation(updated)
	}
	if !slices.Contains(rolling, dep.Name) {
		r.runnerRoll.rolling = append(rolling, dep.Name)
		sort.Strings(r.runnerRoll.rolling)
	}
	if err := r.client.CoreV1().ConfigMaps(dep.Namespace).Delete(ctx, dep.Name+legacyRunnerReleaseSuffix, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
		slog.Warn("vm runner: removing the release ConfigMap the rolled pod no longer mounts", "owner", owner, "error", err)
	}
	slog.Info("vm runner: rolling the pod", "owner", owner, "template", hash, "machines", dep.Annotations[annRunnerAwaiting])
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the pod is what the hash covers, so a runner whose pod is unchanged is not rolled — but its own labels and owner references can still drift, from a hand edit or from the runner ServiceAccount being recreated with a new UID, and a Deployment owned by nothing outlives the release. Those are put back with a metadata-only update, which does not change the pod and so restarts no machine. An owner reference the controller could not resolve this pass is not written, rather than stripping the one the runner has.
// UNIT_BOUNDARY_DESCRIPTION: the hash a runner rendered before the roll left its memory out (runnerRollSpec). That hash covered the memory limit and request the runner was rendered with, which for an owner with a UserBudget was the install's rather than their pool, so they are taken from the runner's own template, not the one rendered now. A runner whose hash matches has the pod the controller renders now in all but its memory, which the resize sets in place, so it takes the new hash in a metadata-only update rather than rolling every machine of every owner once.
func legacyRunnerTemplateHash(desired, existing appsv1.DeploymentSpec) string {
	legacy := runnerRollSpec(desired)
	for i := range legacy.Template.Spec.Containers {
		c := &legacy.Template.Spec.Containers[i]
		old := slices.IndexFunc(existing.Template.Spec.Containers, func(o corev1.Container) bool { return o.Name == c.Name })
		if old < 0 {
			continue
		}
		res := existing.Template.Spec.Containers[old].Resources
		if mem, ok := res.Limits[corev1.ResourceMemory]; ok {
			if c.Resources.Limits == nil {
				c.Resources.Limits = corev1.ResourceList{}
			}
			c.Resources.Limits[corev1.ResourceMemory] = mem
		}
		if mem, ok := res.Requests[corev1.ResourceMemory]; ok {
			if c.Resources.Requests == nil {
				c.Resources.Requests = corev1.ResourceList{}
			}
			c.Resources.Requests[corev1.ResourceMemory] = mem
		}
	}
	hash, err := runnerTemplateHash(legacy)
	if err != nil {
		return ""
	}
	return hash
}

func (r *AgentReconciler) repairRunnerDeploymentMeta(ctx context.Context, owner string, existing, desired *appsv1.Deployment) error {
	_, waited := existing.Annotations[annRunnerBusy]
	delete(existing.Annotations, annRunnerBusy)
	if !repairRunnerMeta(&existing.ObjectMeta, desired.Labels, desired.OwnerReferences) && !waited {
		return nil
	}
	if _, err := r.client.AppsV1().Deployments(existing.Namespace).Update(ctx, existing, metav1.UpdateOptions{}); err != nil {
		return err
	}
	slog.Info("vm runner: restored the runner's labels and owner", "owner", owner)
	return nil
}

func repairRunnerMeta(meta *metav1.ObjectMeta, labels map[string]string, refs []metav1.OwnerReference) bool {
	changed := false
	for k, v := range labels {
		if meta.Labels[k] != v {
			if meta.Labels == nil {
				meta.Labels = map[string]string{}
			}
			meta.Labels[k] = v
			changed = true
		}
	}
	if len(refs) > 0 && !slices.EqualFunc(meta.OwnerReferences, refs, func(a, b metav1.OwnerReference) bool { return a.UID == b.UID && a.Name == b.Name && a.Kind == b.Kind }) {
		meta.OwnerReferences = refs
		changed = true
	}
	return changed
}

// UNIT_BOUNDARY_DESCRIPTION: a roll reboots every machine of the owner, and an agent in the middle of a turn loses that turn. So a changed runner whose owner has a busy agent — one whose `/api/status` does not say `idle`, the idle checker's own probe — does not take its place in the roll: it holds no place, so other owners roll meanwhile, and the next pass or sweep offers it again. The agents are probed at once, so an owner with many machines waits one probe timeout rather than one per machine. `rollout.idleWait` bounds the wait from the first pass that found it busy, recorded on the Deployment so a controller restart does not start the wait over; past it, the runner rolls with the agent busy, since an owner who is never idle must still get the release. An agent that does not answer counts as idle.
// UNIT_BOUNDARY_DESCRIPTION: a runner that cannot reach the node's image cache service boots only the trees its own machines already hold, so every image its owner has not booted yet is refused, and the image update job holds every move it makes. Waiting for a turn to end protects that turn and, once the cache is truly gone, costs the owner every image move for as long as the idle wait — so such a runner rolls without waiting. Only that case, asked of the runner itself: a runner that answers nothing at all may still have a working cache and is waited for as before. And only once the refusal has lasted `defaultRunnerCacheDownGrace`: one refused connect is also what a cache service restarted or a socket rebound under a healthy runner looks like, and rolling on it would end the turns the wait exists to protect. The first pass that sees the refusal records when it saw it on the Deployment; the pass that finds it older than the grace rolls, or keeps waiting while the write that would clear it does not land.
// UNIT_BOUNDARY_DESCRIPTION: a hold is recorded and reported once per transition rather than once per pass, and only after the write that records it landed: a pass whose annotation write conflicts reads the runner as it was, would report the same transition again, and the read-your-writes cache keeps that from happening at all. Its age is observed as a metric while it lasts.
func (r *AgentReconciler) runnerRollWaitsForIdle(ctx context.Context, owner string, existing *appsv1.Deployment) bool {
	if refused := r.runnerImageCacheRefused(ctx, owner); refused != "" {
		since, down := runnerHoldSince(existing, annRunnerCacheDown)
		now := time.Now()
		if !down {
			if updated := r.annotateRunner(ctx, existing, annRunnerCacheDown, now.UTC().Format(time.RFC3339)); updated != nil {
				slog.Info("vm runner: the runner cannot reach the node's image cache, holding its roll a moment in case the cache comes back", "owner", owner, "imageCache", refused)
				r.runnerEvent(ctx, updated, corev1.EventTypeNormal, reasonRollHeldForCache, fmt.Sprintf("holding this runner's changed pod back for %s: it cannot reach the node's image cache, so it boots only images its machines already hold, and its roll skips the idle wait if no service answers by then. %s", defaultRunnerCacheDownGrace, refused))
			}
			telemetry.RunnerRollHeld(owner, now)
			return true
		}
		held := time.Since(since)
		if held < defaultRunnerCacheDownGrace {
			telemetry.RunnerRollHeld(owner, since)
			return true
		}
		existing = r.annotateRunner(ctx, existing, annRunnerCacheDown, "")
		if existing == nil {
			telemetry.RunnerRollHeld(owner, since)
			return true
		}
		slog.Warn("vm runner: the runner has not reached the node's image cache for longer than the grace, rolling it without waiting for its owner's agents to go idle", "owner", owner, "since", since, "imageCache", refused)
		mount := ""
		if source := runnerImageCacheSource(existing); source != "" {
			mount = " It mounts the node's " + source + " as its image cache."
		}
		r.runnerEvent(ctx, existing, corev1.EventTypeWarning, reasonRollImageCacheUnreachable, fmt.Sprintf("rolling this runner without waiting for its owner's agents to go idle: it has not reached the node's image cache for %s, so it boots only images its machines already hold.%s %s", held.Truncate(time.Minute), mount, refused))
		telemetry.RunnerRollEnded(owner)
		return false
	}
	existing = r.runnerHoldEnds(ctx, existing, annRunnerCacheDown)

	ready := r.readyMachines(ctx, owner)
	probed := make([]bool, len(ready))
	var wg sync.WaitGroup
	for i, id := range ready {
		wg.Go(func() { probed[i] = r.busyProbe(ctx, id) })
	}
	wg.Wait()
	var busy []string
	for i, id := range ready {
		if probed[i] {
			busy = append(busy, id)
		}
	}
	if len(busy) == 0 {
		telemetry.RunnerRollEnded(owner)
		return false
	}
	wait := r.config.VM.Runner.Rollout.IdleWait.AsDuration()
	if wait <= 0 {
		wait = defaultRunnerIdleWait
	}
	since, held := runnerHoldSince(existing, annRunnerBusy)
	if !held {
		now := time.Now()
		if updated := r.annotateRunner(ctx, existing, annRunnerBusy, now.UTC().Format(time.RFC3339)); updated != nil {
			slog.Info("vm runner: the pod changed, waiting for the owner's agents to finish their turns", "owner", owner, "busy", busy, "idleWait", wait)
			r.runnerEvent(ctx, updated, corev1.EventTypeNormal, reasonRollHeldForIdle, fmt.Sprintf("holding this runner's changed pod back until %s goes idle, at most %s; its machines reboot when it rolls", strings.Join(busy, ", "), wait))
		}
		telemetry.RunnerRollHeld(owner, now)
		return true
	}
	age := time.Since(since)
	if age < wait {
		telemetry.RunnerRollHeld(owner, since)
		return true
	}
	slog.Warn("vm runner: the owner's agents stayed busy past the idle wait, rolling anyway", "owner", owner, "busy", busy, "since", since, "idleWait", wait)
	r.runnerEvent(ctx, existing, corev1.EventTypeWarning, reasonRollIdleWaitOver, fmt.Sprintf("rolling this runner past the idle wait: %s stayed busy for %s, the whole %s, and its machines reboot when it rolls", strings.Join(busy, ", "), age.Truncate(time.Minute), wait))
	telemetry.RunnerRollEnded(owner)
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: when the hold a runner's annotation names started, and whether it names one at all: a missing or unreadable stamp is no hold, since the pass that writes the next one reports it.
func runnerHoldSince(dep *appsv1.Deployment, key string) (time.Time, bool) {
	since, err := time.Parse(time.RFC3339, dep.Annotations[key])
	return since, err == nil
}

// UNIT_BOUNDARY_DESCRIPTION: clears a hold stamp the runner no longer justifies, and answers with the Deployment as it now stands rather than as the pass read it, so a later write of another stamp carries this clearing rather than undoing it. A stamp left behind when the write fails is one pass worse than a lost transition, and the next pass writes it again.
func (r *AgentReconciler) runnerHoldEnds(ctx context.Context, dep *appsv1.Deployment, key string) *appsv1.Deployment {
	if _, held := runnerHoldSince(dep, key); !held {
		return dep
	}
	if updated := r.annotateRunner(ctx, dep, key, ""); updated != nil {
		return updated
	}
	return dep
}

// UNIT_BOUNDARY_DESCRIPTION: writes one annotation on the runner Deployment and answers with the object as written, or nil when the write did not land. The read-your-writes cache takes the write, so the next pass reads what this one wrote rather than the informer's copy from before it, and a transition is reported once; a failed write reports nothing and leaves the same transition to the next pass. The caller writes from the object it got back rather than from the one it read: a second stamp written from the older copy would put back the first one.
func (r *AgentReconciler) annotateRunner(ctx context.Context, existing *appsv1.Deployment, key, value string) *appsv1.Deployment {
	dep := existing.DeepCopy()
	if dep.Annotations == nil {
		dep.Annotations = map[string]string{}
	}
	if value == "" {
		delete(dep.Annotations, key)
	} else {
		dep.Annotations[key] = value
	}
	updated, err := r.client.AppsV1().Deployments(dep.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
	if err != nil {
		slog.Warn("vm runner: recording the runner's roll state", "runner", dep.Name, "annotation", key, "error", err)
		return nil
	}
	if r.runnerDeploys != nil {
		r.runnerDeploys.Mutation(updated)
	}
	return updated
}

// UNIT_BOUNDARY_DESCRIPTION: whether the owner's runner says right now that it cannot reach the node's image cache service, and what it says about the socket. A runner that cannot be asked at all is not this case: it may have a working cache, and its absence is its own fault that the roll's settle timeout handles.
func (r *AgentReconciler) runnerImageCacheRefused(ctx context.Context, owner string) string {
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return ""
	}
	cache, err := client.ImageCache(ctx)
	if err != nil {
		slog.Warn("vm runner: asking a runner about its image cache", "owner", owner, "error", err)
		return ""
	}
	return cache.Error
}

// UNIT_BOUNDARY_DESCRIPTION: the node directory this owner's runner mounts as its image cache, read from its Deployment rather than from what the controller would render now, so a runner left behind by a move names the directory it actually holds. A runner the install runs outside the cluster has no Deployment, and then nothing is named.
func (r *AgentReconciler) runnerImageCacheSourceOf(ctx context.Context, owner string) string {
	dep, err := r.runnerDeployment(ctx, r.runnerName(owner), true)
	if err != nil {
		return ""
	}
	return runnerImageCacheSource(dep)
}

// UNIT_BOUNDARY_DESCRIPTION: the node directory the runner in this Deployment mounts as its image cache.
func runnerImageCacheSource(dep *appsv1.Deployment) string {
	for _, volume := range dep.Spec.Template.Spec.Volumes {
		if volume.Name == "image-cache" && volume.HostPath != nil {
			return volume.HostPath.Path
		}
	}
	return ""
}

func (r *AgentReconciler) readyMachines(ctx context.Context, owner string) []string {
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return nil
	}
	ids, err := client.List(ctx)
	if err != nil {
		slog.Warn("vm runner: cannot list the machines to wait for after the roll", "owner", owner, "error", err)
		return nil
	}
	var ready []string
	for _, id := range ids {
		if st, err := client.Status(ctx, id); err == nil && st.Ready {
			ready = append(ready, id)
		}
	}
	sort.Strings(ready)
	return ready
}

// UNIT_BOUNDARY_DESCRIPTION: the runners still mid-roll or mid-hand-off, read from the Deployments' annotations alone. Every owner's roll decision reads this under one lock, so it calls no runner: a hung runner would hold that lock for a call timeout and stall every owner's agent starts. Whether a runner's machines came back, or its runner took a new release, is asked on that owner's own turn (settleRunnerRoll, settleRunnerHandoff), which clears the annotations. A roll that has settled by its annotations alone — its new pod is ready and it had no machines to wait for — has them removed here, so the next pass reads it as settled. A roll whose new pod became ready but whose machines did not all come back within `rollout.settleTimeout` stops holding its place: a machine whose agent stopped during the roll never comes back, and it must not stall every other owner's upgrade. A roll whose new pod never became ready keeps its place instead — a pod that does not start is a broken runner release, and letting the next owner roll would break them too — and is marked stalled, reported at error level and counted, once — unless the pod never started for a fault of its owner alone (runnerPodStuckOnItsOwner), which is skipped.
func (r *AgentReconciler) runnersMidRoll(ctx context.Context) ([]string, error) {
	if !r.runnerRoll.at.IsZero() && time.Since(r.runnerRoll.at) < r.rollViewTTL {
		return r.runnerRoll.rolling, nil
	}
	cli := r.client.AppsV1().Deployments(r.config.Namespace)
	list, err := cli.List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + vmRunnerComponent})
	if err != nil {
		return nil, err
	}
	_, timeout := runnerRolloutLimits(r.config.VM.Runner)
	var rolling []string
	for i := range list.Items {
		dep := &list.Items[i]
		if r.runnerHandoffHolds(dep) {
			rolling = append(rolling, dep.Name)
		}
		if dep.Annotations[annRunnerRolledAt] == "" {
			continue
		}
		settled, stalled := r.runnerRollSettled(ctx, dep, timeout)
		if !settled {
			if !slices.Contains(rolling, dep.Name) {
				rolling = append(rolling, dep.Name)
			}
			if stalled && dep.Annotations[annRunnerStalled] == "" {
				r.markRunnerRollStalled(ctx, dep, timeout)
			}
			continue
		}
		delete(dep.Annotations, annRunnerRolledAt)
		delete(dep.Annotations, annRunnerAwaiting)
		delete(dep.Annotations, annRunnerStalled)
		if _, err := cli.Update(ctx, dep, metav1.UpdateOptions{}); err != nil {
			slog.Warn("vm runner: clearing a settled roll", "runner", dep.Name, "error", err)
		}
	}
	sort.Strings(rolling)
	r.runnerRoll = runnerRollView{at: time.Now(), rolling: rolling}
	return rolling, nil
}

// UNIT_BOUNDARY_DESCRIPTION: an Event on the runner's Deployment, so a roll held back, or let through, is legible in `kubectl get events` and across the fleet without reading the controller's log and without one line per reconcile. Its name carries the nanosecond, as the controller's other Events do, so two transitions write two Events. An Event that cannot be written is logged and never fails the roll.
func (r *AgentReconciler) runnerEvent(ctx context.Context, dep *appsv1.Deployment, eventType, reason, message string) {
	now := metav1.Now()
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s.%x", dep.Name, now.UnixNano()), Namespace: dep.Namespace},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
			Name:       dep.Name,
			Namespace:  dep.Namespace,
			UID:        dep.UID,
		},
		Reason:         reason,
		Message:        message,
		Type:           eventType,
		Source:         corev1.EventSource{Component: "platform-controller"},
		FirstTimestamp: now,
		LastTimestamp:  now,
		Count:          1,
	}
	if _, err := r.client.CoreV1().Events(dep.Namespace).Create(ctx, event, metav1.CreateOptions{}); err != nil {
		slog.Warn("vm runner: writing an event on the runner failed", "runner", dep.Name, "reason", reason, "error", err)
	}
}

func (r *AgentReconciler) markRunnerRollStalled(ctx context.Context, dep *appsv1.Deployment, timeout time.Duration) {
	owner := dep.Labels[envoyOwnerLabel]
	slog.Error("vm runner: the rolled pod is not ready after the settle timeout; the roll is halted until it is ready or the runner pod changes again",
		"owner", owner, "runner", dep.Name, "rolledAt", dep.Annotations[annRunnerRolledAt], "timeout", timeout)
	telemetry.RunnerRollStalled(ctx)
	dep.Annotations[annRunnerStalled] = time.Now().UTC().Format(time.RFC3339)
	if _, err := r.client.AppsV1().Deployments(dep.Namespace).Update(ctx, dep, metav1.UpdateOptions{}); err != nil {
		slog.Warn("vm runner: marking a stalled roll", "runner", dep.Name, "error", err)
	}
}

func (r *AgentReconciler) runnerRollSettled(ctx context.Context, dep *appsv1.Deployment, timeout time.Duration) (settled, stalled bool) {
	owner := dep.Labels[envoyOwnerLabel]
	rolledAt, err := time.Parse(time.RFC3339, dep.Annotations[annRunnerRolledAt])
	if err != nil {
		return true, false
	}
	podReady := runnerPodRolledOut(dep)
	if time.Since(rolledAt) > timeout {
		if !podReady {
			if r.runnerPodStuckOnItsOwner(ctx, owner) {
				slog.Error("vm runner: the rolled pod never started for a reason of its own owner, skipping it so the next runner may roll", "owner", owner, "runner", dep.Name, "timeout", timeout)
				telemetry.RunnerRollSkipped(ctx)
				return true, false
			}
			return false, true
		}
		slog.Warn("vm runner: the roll's machines did not all come back in time, the next runner may roll", "owner", owner, "timeout", timeout)
		return true, false
	}
	return podReady && dep.Annotations[annRunnerAwaiting] == "", false
}

// UNIT_BOUNDARY_DESCRIPTION: settles the owner's own roll once its new pod is ready and every machine that was ready before the roll is ready again, or gone with its agent. It runs on the owner's turn, under the owner's lock and outside the roll lock, so the runner it calls holds up only this owner. It returns the Deployment as it now stands.
func (r *AgentReconciler) settleRunnerRoll(ctx context.Context, owner string, dep *appsv1.Deployment) *appsv1.Deployment {
	awaiting := dep.Annotations[annRunnerAwaiting]
	if dep.Annotations[annRunnerRolledAt] == "" || awaiting == "" || !runnerPodRolledOut(dep) {
		return dep
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return dep
	}
	for _, id := range strings.Split(awaiting, ",") {
		if st, err := client.Status(ctx, id); err == nil && st.Ready {
			continue
		}
		if _, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, id, metav1.GetOptions{}); k8serrors.IsNotFound(err) {
			continue
		}
		return dep
	}
	settled := dep.DeepCopy()
	delete(settled.Annotations, annRunnerRolledAt)
	delete(settled.Annotations, annRunnerAwaiting)
	delete(settled.Annotations, annRunnerStalled)
	updated, err := r.client.AppsV1().Deployments(dep.Namespace).Update(ctx, settled, metav1.UpdateOptions{})
	if err != nil {
		slog.Warn("vm runner: clearing a settled roll", "runner", dep.Name, "error", err)
		return dep
	}
	if r.runnerDeploys != nil {
		r.runnerDeploys.Mutation(updated)
	}
	r.resetRunnerRollView()
	return updated
}

// UNIT_BOUNDARY_DESCRIPTION: a runner can hold its place by two records at once, a pod roll and a hand-off, and one settling says nothing of the other. So a settle drops the kept view, and the next decision reads both records again.
func (r *AgentReconciler) resetRunnerRollView() {
	r.runnerRollMu.Lock()
	defer r.runnerRollMu.Unlock()
	r.runnerRoll = runnerRollView{}
}

// UNIT_BOUNDARY_DESCRIPTION: whether the roll has a place for this runner: fewer than `rollout.maxConcurrent` others are mid-roll or mid-hand-off. The caller holds runnerRollMu. A runner that finds one asks its own runner which machines are ready with the lock released, then asks again with it held before it takes the place, so no runner call is made under the lock.
func (r *AgentReconciler) runnerRollPlace(ctx context.Context, owner, name, waiting string) (rolling []string, free bool, err error) {
	rolling, err = r.runnersMidRoll(ctx)
	if err != nil {
		return nil, false, err
	}
	limit, _ := runnerRolloutLimits(r.config.VM.Runner)
	others := slices.DeleteFunc(slices.Clone(rolling), func(n string) bool { return n == name })
	if len(others) >= limit {
		slog.Info(waiting, "owner", owner, "rolling", others)
		return rolling, false, nil
	}
	return rolling, true, nil
}

// UNIT_BOUNDARY_DESCRIPTION: whether a rolled pod that is not ready failed for its owner alone rather than for the release. Only states a release cannot plausibly cause count: a pod still creating its containers, none ever started, whose volume the attach controller refuses as Multi-Attach (the claim is still held on another node), or an old pod that never finishes terminating because its node is gone or not ready. A pod the scheduler cannot place halts the roll, because a release that adds a node selector or raises a request makes every runner unschedulable; so do a started container that is not ready, an image that does not pull, no pod at all, and a failed read.
func (r *AgentReconciler) runnerPodStuckOnItsOwner(ctx context.Context, owner string) bool {
	pods, err := r.runnerPods(ctx, owner, true)
	if err != nil {
		slog.Warn("vm runner: listing the rolled pod to tell an owner's fault from a broken release", "owner", owner, "error", err)
		return false
	}
	if len(pods) == 0 {
		return false
	}
	for _, pod := range pods {
		if pod.DeletionTimestamp != nil {
			if !r.nodeLost(ctx, pod.Spec.NodeName) {
				return false
			}
			continue
		}
		for _, c := range slices.Concat(pod.Status.InitContainerStatuses, pod.Status.ContainerStatuses) {
			if c.RestartCount > 0 || c.State.Waiting == nil || (c.State.Waiting.Reason != "ContainerCreating" && c.State.Waiting.Reason != "PodInitializing") {
				return false
			}
		}
		if pod.Spec.NodeName == "" || !r.multiAttachRefused(ctx, &pod) {
			return false
		}
	}
	return true
}

// UNIT_BOUNDARY_DESCRIPTION: a roll of an owner's runner that never finishes because its pod is stuck terminating: its node has gone, or stopped reporting ready, which no roll outgrows — unlike a pod still shutting down on a healthy node.
func (r *AgentReconciler) nodeLost(ctx context.Context, name string) bool {
	if name == "" {
		return false
	}
	node, known := r.node(ctx, name)
	if !known {
		return false
	}
	return node == nil || !slices.ContainsFunc(node.Status.Conditions, func(c corev1.NodeCondition) bool {
		return c.Type == corev1.NodeReady && c.Status == corev1.ConditionTrue
	})
}

// UNIT_BOUNDARY_DESCRIPTION: whether a runner pod is on a node the cluster has lost, which no wait outgrows: the node has stopped reporting ready, and either its pod has begun terminating there — the eviction that leaves the claim on a node that cannot finish it — or its Ready has been off for longer than the grace, past which the kubelet gives up on the pod. A node that only blips is not lost, and neither is one that reports ready: it comes back with the pod, and a pod terminating on it is a pod on its way out on a node that can still finish the job. A node the cluster no longer lists is not lost either, since it collects that node's pods within a minute. known is false when the node cannot be read at all, and then nothing is reported lost on a guess.
func (r *AgentReconciler) nodeLostFor(ctx context.Context, pod *corev1.Pod) (lost, known bool) {
	if pod.Spec.NodeName == "" {
		return false, true
	}
	node, known := r.node(ctx, pod.Spec.NodeName)
	if !known || node == nil {
		return false, known
	}
	for _, c := range node.Status.Conditions {
		if c.Type != corev1.NodeReady {
			continue
		}
		if c.Status == corev1.ConditionTrue {
			return false, true
		}
		return pod.DeletionTimestamp != nil || time.Since(c.LastTransitionTime.Time) > runnerNodeLostGrace, true
	}
	return false, true
}

// UNIT_BOUNDARY_DESCRIPTION: the node by name, nil when the cluster no longer lists it, and known false when it cannot be read — a watch that has not synced, or a read that failed — which tells no node's state apart from another's.
func (r *AgentReconciler) node(ctx context.Context, name string) (*corev1.Node, bool) {
	if r.nodeCache != nil {
		if r.nodeCacheSynced != nil && !r.nodeCacheSynced() {
			return nil, false
		}
		node, err := r.nodeCache.Get(name)
		if err != nil {
			slog.Warn("vm runner: reading a node of the cluster", "node", name, "error", err)
			return nil, false
		}
		return node, true
	}
	node, err := r.client.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return nil, true
	}
	if err != nil {
		slog.Warn("vm runner: reading a node of the cluster", "node", name, "error", err)
		return nil, false
	}
	return node, true
}

func (r *AgentReconciler) multiAttachRefused(ctx context.Context, pod *corev1.Pod) bool {
	events, err := r.client.CoreV1().Events(pod.Namespace).List(ctx, metav1.ListOptions{FieldSelector: "involvedObject.name=" + pod.Name})
	if err != nil {
		slog.Warn("vm runner: reading the events of a runner pod stuck creating", "pod", pod.Name, "error", err)
		return false
	}
	return slices.ContainsFunc(events.Items, func(e corev1.Event) bool {
		return e.InvolvedObject.UID == pod.UID && e.Reason == "FailedAttachVolume" && strings.Contains(e.Message, "Multi-Attach")
	})
}

func runnerPodRolledOut(dep *appsv1.Deployment) bool {
	want := int32(1)
	if dep.Spec.Replicas != nil {
		want = *dep.Spec.Replicas
	}
	st := dep.Status
	return st.ObservedGeneration >= dep.Generation && st.Replicas == want && st.UpdatedReplicas == want && st.ReadyReplicas == want
}

// UNIT_BOUNDARY_DESCRIPTION: a changed runner pod is applied when one of that owner's agents reconciles, and a hibernated owner's agents may not reconcile for days. The sweep offers every runner its turn, so a roll reaches the whole install even where nothing else would ask. Each turn holds the owner's lock and only updates a runner that still exists, so it cannot race the orphan sweep into recreating a runner that sweep has just removed. As many turns run at once as the roll is wide, `rollout.maxConcurrent`, handed out in name order: a turn that names a release waits for it to settle, and a turn that finds no free place returns at once, so the width is what bounds the waiting and a pass over the install takes about owners / width hand-offs rather than one hand-off per owner.
func (r *AgentReconciler) ReconcileRunnerRollout(ctx context.Context) {
	if r.config.VM.Enabled {
		r.rollOwnerGateways(ctx)
	}
	if !r.config.VM.Enabled || r.config.VM.Runner.HostAddress != "" {
		return
	}
	list, err := r.client.AppsV1().Deployments(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/component=" + vmRunnerComponent,
	})
	if err != nil {
		slog.Warn("vm runner rollout: listing runners failed", "error", err)
		return
	}
	sort.Slice(list.Items, func(i, j int) bool { return list.Items[i].Name < list.Items[j].Name })
	refs := r.runnerOwnerRef(ctx)
	limit, _ := runnerRolloutLimits(r.config.VM.Runner)
	turns := make(chan string)
	var wg sync.WaitGroup
	for range limit {
		wg.Go(func() {
			for owner := range turns {
				lock := r.ownerLock(owner)
				lock.Lock()
				err := r.applyRunnerDeployment(ctx, owner, refs, false)
				lock.Unlock()
				if err != nil && !errors.Is(err, errRunnerTerminating) {
					slog.Warn("vm runner rollout: applying a runner failed", "owner", owner, "error", err)
				}
				r.followIdleRunnerHandoff(ctx, owner)
			}
		})
	}
	for i := range list.Items {
		if owner := list.Items[i].Labels[envoyOwnerLabel]; owner != "" && list.Items[i].DeletionTimestamp == nil {
			turns <- owner
		}
	}
	close(turns)
	wg.Wait()
}
