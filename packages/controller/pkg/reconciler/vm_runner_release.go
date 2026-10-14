package reconciler

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const runnerReleaseKey = "release"

// UNIT_BOUNDARY_DESCRIPTION: when the controller last named a new release in a runner's ConfigMap, so it can tell a runner that is restarting onto the release from one that has not come back.
const annRunnerReleaseNamedAt = "agent-platform.ai/runner-release-named-at"

// UNIT_BOUNDARY_DESCRIPTION: how long a runner may stay unreachable after the controller named it a new release before the pod is rolled. A hand-off leaves the machine API down for seconds; one still down after this is a loader that cannot bring up the new release or the one it replaced, for example after a runtime changed state the old one cannot read, and only a new pod gets the machines a working runner again.
const runnerReleaseUnreachableRoll = 10 * time.Minute

func (r *AgentReconciler) runnerReleaseName(owner string) string {
	return r.runnerName(owner) + "-release"
}

// UNIT_BOUNDARY_DESCRIPTION: a hand-off of this runner to a new release is under way: since when, and which machines were ready when it began. It holds a place in the roll, as a pod roll does, until it settles or stalls.
const (
	// UNIT_BOUNDARY_DESCRIPTION: the shortest a hand-off of a runner with ready machines lasts. A release that reports running and adopts every machine can still refuse every ensure, and only an agent's reconcile ensures; each running agent reconciles at least once a health poll, so two polls give each of them an ensure against the new release before the next owner is named one. A runner with no ready machine has no ensure to wait for.
	runnerHandoffObserve = 2 * vmHealthPoll

	annRunnerHandoffAt       = "agent-platform.ai/runner-handoff-at"
	annRunnerHandoffAwaiting = "agent-platform.ai/runner-handoff-awaiting"
	annRunnerHandoffStalled  = "agent-platform.ai/runner-handoff-stalled"
)

// UNIT_BOUNDARY_DESCRIPTION: names the runner release an owner's runner pod should run: the runner image this controller is configured with. The pod's loader reads it from the mounted ConfigMap and hands the machines to that release once the node's stager has staged it, so a new runner image reaches an owner without a pod restart. A hand-off reboots nothing, but a release that runs and then refuses the machines' ensures would still break every owner it reaches, so a new release is named only while fewer than `rollout.maxConcurrent` runners are mid-roll or mid-hand-off, the same width as a pod roll. A hand-off ends no turn, so it does not wait for idle agents. A ConfigMap that names the pod's own image needs no hand-off and is written at once. The ConfigMap is owned by the runner's Deployment, so it goes wherever the Deployment goes.
func (r *AgentReconciler) applyRunnerRelease(ctx context.Context, owner string) error {
	ns, name, release := r.config.Namespace, r.runnerReleaseName(owner), r.config.VM.Runner.Image
	dep, err := r.runnerDeployment(ctx, r.runnerName(owner), true)
	if k8serrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	cms := r.client.CoreV1().ConfigMaps(ns)
	existing, err := cms.Get(ctx, name, metav1.GetOptions{})
	found := err == nil
	if err != nil && !k8serrors.IsNotFound(err) {
		return err
	}
	if !found {
		existing = &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       ns,
			Labels:          vmRunnerLabels(owner, r.config.ReleaseName),
			OwnerReferences: []metav1.OwnerReference{*metav1.NewControllerRef(dep, appsv1.SchemeGroupVersion.WithKind("Deployment"))},
		}}
		if containers := dep.Spec.Template.Spec.Containers; len(containers) > 0 {
			existing.Data = map[string]string{runnerReleaseKey: containers[0].Image}
		}
	}
	if existing.Data[runnerReleaseKey] == release && found {
		r.settleRunnerHandoff(ctx, existing)
		return nil
	}
	handoff := existing.Data[runnerReleaseKey] != release
	if existing.Annotations == nil {
		existing.Annotations = map[string]string{}
	}
	existing.Data = map[string]string{runnerReleaseKey: release}
	existing.Annotations[annRunnerReleaseNamedAt] = time.Now().UTC().Format(time.RFC3339)
	if !handoff {
		_, err = cms.Create(ctx, existing, metav1.CreateOptions{})
		return err
	}

	const waiting = "vm runner: a new release is waiting for other runners to finish rolling or handing off"
	r.runnerRollMu.Lock()
	_, free, err := r.runnerRollPlace(ctx, owner, dep.Name, waiting)
	r.runnerRollMu.Unlock()
	if err != nil || !free {
		return err
	}
	ready := r.readyMachines(ctx, owner)
	r.runnerRollMu.Lock()
	defer r.runnerRollMu.Unlock()
	rolling, free, err := r.runnerRollPlace(ctx, owner, dep.Name, waiting)
	if err != nil || !free {
		return err
	}
	delete(existing.Annotations, annRunnerHandoffStalled)
	delete(existing.Annotations, annRunnerHandoffAwaiting)
	existing.Annotations[annRunnerHandoffAt] = existing.Annotations[annRunnerReleaseNamedAt]
	if len(ready) > 0 {
		existing.Annotations[annRunnerHandoffAwaiting] = strings.Join(ready, ",")
	}
	if !found {
		_, err = cms.Create(ctx, existing, metav1.CreateOptions{})
	} else {
		_, err = cms.Update(ctx, existing, metav1.UpdateOptions{})
	}
	if err != nil {
		return err
	}
	if !slices.Contains(rolling, dep.Name) {
		r.runnerRoll.rolling = append(rolling, dep.Name)
		sort.Strings(r.runnerRoll.rolling)
	}
	slog.Info("vm runner: handing the machines to a new release", "owner", owner, "release", release, "machines", existing.Annotations[annRunnerHandoffAwaiting])
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: whether a runner's hand-off still holds its place in the roll, read from its ConfigMap alone, since every owner's roll decision reads it under one lock (runnersMidRoll). A hand-off under way holds until its owner's own turn settles or stalls it (settleRunnerHandoff). A stalled hand-off keeps its place, so the release goes no further, until a newer release is configured or an operator removes the stall annotation from the runner's release ConfigMap.
func (r *AgentReconciler) runnerHandoffHolds(cm *corev1.ConfigMap) bool {
	if cm.Annotations[annRunnerHandoffStalled] != "" {
		return cm.Data[runnerReleaseKey] == r.config.VM.Runner.Image
	}
	_, err := time.Parse(time.RFC3339, cm.Annotations[annRunnerHandoffAt])
	return err == nil
}

// UNIT_BOUNDARY_DESCRIPTION: settles or stalls the owner's own hand-off, on the owner's turn and outside the roll lock, so the runner it calls holds up only this owner. It settles once the runner reports the release running, every machine that was ready before is ready again, stopped, or gone with its agent, and, if there were such machines, runnerHandoffObserve has passed without an ensure refused; a release the pod cannot take ends the hand-off too, since the pod roll that follows holds its own place. It stalls when the runner holds the release as failed, or when it has not settled within `rollout.settleTimeout`; an ensure the runner refuses stalls it from the agent's reconcile (stallRunnerHandoffOnEnsure).
func (r *AgentReconciler) settleRunnerHandoff(ctx context.Context, cm *corev1.ConfigMap) {
	started, err := time.Parse(time.RFC3339, cm.Annotations[annRunnerHandoffAt])
	if err != nil || cm.Annotations[annRunnerHandoffStalled] != "" {
		return
	}
	settled, trouble := r.runnerHandoffSettled(ctx, cm, started)
	if settled {
		delete(cm.Annotations, annRunnerHandoffAt)
		delete(cm.Annotations, annRunnerHandoffAwaiting)
		if _, err := r.client.CoreV1().ConfigMaps(cm.Namespace).Update(ctx, cm, metav1.UpdateOptions{}); err != nil {
			slog.Warn("vm runner: clearing a settled hand-off", "configmap", cm.Name, "error", err)
			return
		}
		r.leaveRunnerRoll(r.runnerName(cm.Labels[envoyOwnerLabel]))
		return
	}
	if _, timeout := runnerRolloutLimits(r.config.VM.Runner); trouble == "" && time.Since(started) > timeout {
		trouble = "the runner did not settle on the release within the settle timeout of " + timeout.String()
	}
	if trouble != "" {
		r.stallRunnerHandoff(ctx, cm, trouble)
	}
}

func (r *AgentReconciler) runnerHandoffSettled(ctx context.Context, cm *corev1.ConfigMap, started time.Time) (settled bool, trouble string) {
	owner, want, awaiting := cm.Labels[envoyOwnerLabel], cm.Data[runnerReleaseKey], cm.Annotations[annRunnerHandoffAwaiting]
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return false, ""
	}
	release, err := client.Release(ctx)
	switch {
	case err != nil:
		return false, ""
	case release.Target == want && release.Held == vmrunner.HeldFailed:
		return false, "the runner holds the release as failed and went back to " + release.Running
	case release.Target == want && release.Held == vmrunner.HeldRuntime:
		return true, ""
	case release.Running != want, awaiting != "" && time.Since(started) < runnerHandoffObserve:
		return false, ""
	}
	for _, id := range strings.Split(awaiting, ",") {
		if id == "" {
			continue
		}
		if st, err := client.Status(ctx, id); err == nil && (st.Ready || machineStopped(st)) {
			continue
		}
		if _, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, id, metav1.GetOptions{}); k8serrors.IsNotFound(err) {
			continue
		}
		return false, ""
	}
	return true, ""
}

func (r *AgentReconciler) stallRunnerHandoff(ctx context.Context, cm *corev1.ConfigMap, trouble string) {
	slog.Error("vm runner: the hand-off to a new release is in trouble; the release is halted until a newer one is configured or the stall annotation is removed",
		"owner", cm.Labels[envoyOwnerLabel], "release", cm.Data[runnerReleaseKey], "handoffAt", cm.Annotations[annRunnerHandoffAt], "trouble", trouble, "annotation", annRunnerHandoffStalled)
	telemetry.RunnerHandoffStalled(ctx)
	delete(cm.Annotations, annRunnerHandoffAt)
	delete(cm.Annotations, annRunnerHandoffAwaiting)
	cm.Annotations[annRunnerHandoffStalled] = time.Now().UTC().Format(time.RFC3339)
	if _, err := r.client.CoreV1().ConfigMaps(cm.Namespace).Update(ctx, cm, metav1.UpdateOptions{}); err != nil {
		slog.Warn("vm runner: marking a stalled hand-off", "configmap", cm.Name, "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a pod roll starts the runner on the configured image, so a hand-off still under way or stalled on it is moot, and the roll holds the place from now on.
func (r *AgentReconciler) endRunnerHandoff(ctx context.Context, owner string) {
	cms := r.client.CoreV1().ConfigMaps(r.config.Namespace)
	cm, err := cms.Get(ctx, r.runnerReleaseName(owner), metav1.GetOptions{})
	if err != nil || cm.Annotations[annRunnerHandoffAt] == "" && cm.Annotations[annRunnerHandoffStalled] == "" {
		return
	}
	delete(cm.Annotations, annRunnerHandoffAt)
	delete(cm.Annotations, annRunnerHandoffAwaiting)
	delete(cm.Annotations, annRunnerHandoffStalled)
	if _, err := cms.Update(ctx, cm, metav1.UpdateOptions{}); err != nil {
		slog.Warn("vm runner: ending a hand-off the pod roll replaces", "owner", owner, "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an ensure the owner's runner refused while it is handing off to a new release is that release's trouble signal: a release that runs but cannot manage machines reports as running. A runner that cannot be reached, or answers that it is shutting down, is the hand-off itself, and a refused token is not the release's doing, so those do not count.
func (r *AgentReconciler) stallRunnerHandoffOnEnsure(ctx context.Context, owner string, err error) {
	var unreachable *vmrunner.UnreachableError
	if err == nil || r.config.VM.Runner.ReleaseHostPath == "" || errors.As(err, &unreachable) || errors.Is(err, vmrunner.ErrUnavailable) || errors.Is(err, vmrunner.ErrUnauthorized) {
		return
	}
	cm, getErr := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, r.runnerReleaseName(owner), metav1.GetOptions{})
	if getErr != nil || cm.Annotations[annRunnerHandoffAt] == "" {
		return
	}
	r.stallRunnerHandoff(ctx, cm, "an ensure failed: "+err.Error())
}

// UNIT_BOUNDARY_DESCRIPTION: forgets when the runner's release was named, once the runner has answered with an outcome of the hand-off: that it runs the release, or that it holds it as failed and runs the one before. The stamp stands only for a hand-off whose outcome is not known yet; left in place, any later blip in such a runner — a crash and restart — would read as a hand-off that never came back and roll the pod, onto a release that failed in the second case. A release held as not staged yet has its hand-off still ahead, so it keeps the stamp.
func (r *AgentReconciler) clearRunnerReleaseNamed(ctx context.Context, owner string) {
	cms := r.client.CoreV1().ConfigMaps(r.config.Namespace)
	cm, err := cms.Get(ctx, r.runnerReleaseName(owner), metav1.GetOptions{})
	if err != nil || cm.Annotations[annRunnerReleaseNamedAt] == "" {
		return
	}
	delete(cm.Annotations, annRunnerReleaseNamedAt)
	if _, err := cms.Update(ctx, cm, metav1.UpdateOptions{}); err != nil {
		slog.Warn("vm runner: clearing the time its release was named", "owner", owner, "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: whether the runner's release was named more than runnerReleaseUnreachableRoll ago. A ConfigMap that is missing, or whose time cannot be read, says nothing, so it never rolls a pod.
func (r *AgentReconciler) runnerReleaseNamedLongAgo(ctx context.Context, owner string) bool {
	cm, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, r.runnerReleaseName(owner), metav1.GetOptions{})
	if err != nil {
		return false
	}
	at, err := time.Parse(time.RFC3339, cm.Annotations[annRunnerReleaseNamedAt])
	return err == nil && time.Since(at) > runnerReleaseUnreachableRoll
}

// UNIT_BOUNDARY_DESCRIPTION: the runner pod as the roll compares it. Its memory limit is the owner's pool, and its memory request is clamped to that pool, and the controller changes both on the running pod in place, so both are left out: a UserBudget that raises or lowers the pool restarts no machine, and a pod created later takes the pool rendered then. With releases staged on the node, the pod's image is only the release it started with — the loader runs whichever one the controller names — so the image, and the env that tells the loader which release it is, are left out too: a new runner image alone changes no pod and restarts no machine.
func runnerRollSpec(spec appsv1.DeploymentSpec, releases bool) appsv1.DeploymentSpec {
	spec = *spec.DeepCopy()
	for i := range spec.Template.Spec.Containers {
		c := &spec.Template.Spec.Containers[i]
		delete(c.Resources.Limits, corev1.ResourceMemory)
		delete(c.Resources.Requests, corev1.ResourceMemory)
		if !releases {
			continue
		}
		c.Image = ""
		for j := range c.Env {
			if c.Env[j].Name == vmRunnerBuiltinEnv {
				c.Env[j].Value = ""
			}
		}
	}
	return spec
}

// UNIT_BOUNDARY_DESCRIPTION: whether a runner pod whose shape is unchanged must still roll to take the configured release. Only a release built for another pod needs a new one — its runner does not load against this pod's libc, or the install keeps one VM runtime per pod — since its loader can never hand the machines to it. A runner that has not answered since it was named the release, for longer than a hand-off ever takes, rolls too; once it answers that it runs the release, or holds it as failed, that clock is cleared. A release that is merely not staged yet comes by itself, and one that failed right after it took over is left to the next release rather than rolled onto, since a pod on it would fail the same way and take the machines down with it.
func (r *AgentReconciler) runnerNeedsPodForRelease(ctx context.Context, owner string, existing *appsv1.Deployment) bool {
	want := r.config.VM.Runner.Image
	containers := existing.Spec.Template.Spec.Containers
	if r.config.VM.Runner.ReleaseHostPath == "" || len(containers) == 0 || containers[0].Image == want {
		return false
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return false
	}
	release, err := client.Release(ctx)
	if err != nil {
		if r.runnerReleaseNamedLongAgo(ctx, owner) {
			slog.Warn("vm runner: the runner has not answered since it was named a new release; rolling the pod", "owner", owner, "release", want, "error", err)
			return true
		}
		return false
	}
	if release.Running == want {
		r.clearRunnerReleaseNamed(ctx, owner)
		return false
	}
	if release.Target != want {
		return false
	}
	switch release.Held {
	case vmrunner.HeldRuntime:
		return true
	case vmrunner.HeldFailed:
		r.clearRunnerReleaseNamed(ctx, owner)
		slog.Warn("vm runner: the runner release exited right after it took over; the owner keeps the release it ran before", "owner", owner, "release", want, "running", release.Running)
	}
	return false
}
