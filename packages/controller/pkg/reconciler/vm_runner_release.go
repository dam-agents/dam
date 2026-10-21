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

// UNIT_BOUNDARY_DESCRIPTION: a runner's hand-off is recorded on its Deployment, the one object of a runner the controller owns and already reads on every turn, as metadata, which changes no pod. The release names what the controller asked the runner's loader to run, so a restarted controller resumes the hand-off and a pod that restarted, and so forgot it, is told it again. The rest says since when a hand-off holds a place in the roll, which machines were ready when it began, and whether it stalled.
const (
	annRunnerRelease         = "agent-platform.ai/runner-release"
	annRunnerReleaseNamedAt  = "agent-platform.ai/runner-release-named-at"
	annRunnerHandoffAt       = "agent-platform.ai/runner-handoff-at"
	annRunnerHandoffAwaiting = "agent-platform.ai/runner-handoff-awaiting"
	annRunnerHandoffStalled  = "agent-platform.ai/runner-handoff-stalled"

	// UNIT_BOUNDARY_DESCRIPTION: how long a runner may stay unreachable after the controller named it a new release before the pod is rolled. A hand-off leaves the machine API down for seconds; one still down after this is a loader that cannot bring up the new release or the one it replaced, and only a new pod gets the machines a working runner again.
	runnerReleaseUnreachableRoll = 10 * time.Minute

	// UNIT_BOUNDARY_DESCRIPTION: the shortest a hand-off of a runner with ready machines lasts. A release that reports running and adopts every machine can still refuse every ensure, and only an agent's reconcile ensures; naming the release writes the runner's Deployment, which requeues every vm Agent of that owner, so each ensures against the new release at once and a refusal stalls the hand-off from there. This window is what gives such a refusal time to show before the next owner is named the release. A runner with no ready machine has no ensure to wait for.
	runnerHandoffObserve = 2 * vmHealthPoll

	// UNIT_BOUNDARY_DESCRIPTION: how often the sweep asks a runner with nothing running whether it took its release yet. The loader reads the release it is named every second.
	runnerHandoffFollowPoll = time.Second

	// UNIT_BOUNDARY_DESCRIPTION: a release the node's stager has not staged yet is no fault of the release, and a chart upgrade stages it on every node at once, each after its own image pull. While the runner reports it not staged, the hand-off's start moves up to now, at most this often, so the settle timeout counts from about when the release reached the node rather than from when it was named. A stager that never stages it keeps the hand-off waiting, and its place, without a stall.
	runnerHandoffUnstagedRestart = time.Minute

	// UNIT_BOUNDARY_DESCRIPTION: the message a hand-off logs when the roll has no free place for its owner, so a test reads the give-up from the controller's own log rather than trusting that no owner went missing.
	handoffWaitsForPlace = "vm runner: a new release is waiting for other runners to finish rolling or handing off"

	// UNIT_BOUNDARY_DESCRIPTION: the ConfigMap a controller before the machine API's release call named each runner's release in, owned by the runner's Deployment. Only a pod that controller rendered mounts it, and that pod rolls once onto the pod this controller renders, so the roll deletes it. Remove this once every install has run a controller with this change.
	legacyRunnerReleaseSuffix = "-release"
)

// UNIT_BOUNDARY_DESCRIPTION: names the runner release an owner's runner pod should run, the runner image this controller is configured with, to the pod's loader over the runner's machine API, which hands the machines to it once the node's stager has staged it, so a new runner image reaches an owner without a pod restart. A hand-off reboots nothing, but a release that runs and then refuses the machines' ensures would still break every owner it reaches, so a new release is named only while fewer than the roll's width (`rollout.maxConcurrent`, or `rollout.maxConcurrentPercent` of the install's runners) of runners are mid-roll or mid-hand-off. A runner already mid-hand-off takes the release in the place it holds (runnerRollPlace): a fleet that shrinks under a share leaves more runners on a broken release than the width has places, and counting their peers alone would never offer them the corrected one. A hand-off ends no turn, so it does not wait for idle agents. A runner whose pod is about to roll is left to the roll, which starts it on the configured image. The release is recorded before the runner is called, and named again on a later turn while the runner does not report it, so a failed call or a controller restart only delays the hand-off. A release that declares its machines must reboot onto it holds the hand-off (`reboot`), which ends it: the pod rolls onto the release instead.
func (r *AgentReconciler) applyRunnerRelease(ctx context.Context, owner string, rendered *appsv1.Deployment) error {
	release := r.config.VM.Runner.Image
	hash, err := runnerTemplateHash(runnerRollSpec(rendered.Spec))
	if err != nil {
		return err
	}
	dep, err := r.runnerDeployment(ctx, rendered.Name, true)
	if k8serrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if dep.DeletionTimestamp != nil || dep.Annotations[annRunnerTemplate] != hash {
		return nil
	}
	if runnerReleaseOf(dep) == release {
		r.settleRunnerHandoff(ctx, owner, dep)
		return nil
	}
	r.runnerRollMu.Lock()
	_, free, err := r.runnerRollPlace(ctx, owner, dep.Name, handoffWaitsForPlace, true)
	r.runnerRollMu.Unlock()
	if err != nil || !free {
		return err
	}
	ready := r.readyMachines(ctx, owner)
	r.runnerRollMu.Lock()
	rolling, free, err := r.runnerRollPlace(ctx, owner, dep.Name, handoffWaitsForPlace, true)
	if err != nil || !free {
		r.runnerRollMu.Unlock()
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	delete(dep.Annotations, annRunnerHandoffStalled)
	delete(dep.Annotations, annRunnerHandoffAwaiting)
	dep.Annotations[annRunnerRelease] = release
	dep.Annotations[annRunnerReleaseNamedAt] = now
	dep.Annotations[annRunnerHandoffAt] = now
	if len(ready) > 0 {
		dep.Annotations[annRunnerHandoffAwaiting] = strings.Join(ready, ",")
	}
	if err := r.updateRunnerDeployment(ctx, dep); err != nil {
		r.runnerRollMu.Unlock()
		return err
	}
	if !slices.Contains(rolling, dep.Name) {
		r.runnerRoll.rolling = append(rolling, dep.Name)
		sort.Strings(r.runnerRoll.rolling)
	}
	r.runnerRollMu.Unlock()
	slog.Info("vm runner: handing the machines to a new release", "owner", owner, "release", release, "machines", dep.Annotations[annRunnerHandoffAwaiting])
	if client, err := r.runnerFor(ctx, owner); err == nil {
		if err := client.NameRelease(ctx, release); err != nil {
			slog.Warn("vm runner: naming the release to the runner failed; the next turn names it again", "owner", owner, "error", err)
		}
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the release the runner runs, as far as the controller asked: the one it last named, or, before it named any, the pod's own image.
func runnerReleaseOf(dep *appsv1.Deployment) string {
	if named := dep.Annotations[annRunnerRelease]; named != "" {
		return named
	}
	if containers := dep.Spec.Template.Spec.Containers; len(containers) > 0 {
		return containers[0].Image
	}
	return ""
}

// UNIT_BOUNDARY_DESCRIPTION: a runner's annotations are written on its owner's turn while the reconcile goes on reading the same Deployment, so an update puts what the API server returns back into it, and into the cache the next reconcile reads.
func (r *AgentReconciler) updateRunnerDeployment(ctx context.Context, dep *appsv1.Deployment) error {
	updated, err := r.client.AppsV1().Deployments(dep.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
	if err != nil {
		return err
	}
	if r.runnerDeploys != nil {
		r.runnerDeploys.Mutation(updated)
	}
	*dep = *updated
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: whether a runner's hand-off still holds its place in the roll, read from its Deployment alone, since every owner's roll decision reads it under one lock (runnersMidRoll). A hand-off under way holds until its owner's own turn settles or stalls it (settleRunnerHandoff). A stalled hand-off keeps its place, so the release goes no further, until a newer release is configured or an operator removes the stall annotation from the runner's Deployment.
func (r *AgentReconciler) runnerHandoffHolds(dep *appsv1.Deployment) bool {
	if dep.Annotations[annRunnerHandoffStalled] != "" {
		return dep.Annotations[annRunnerRelease] == r.config.VM.Runner.Image
	}
	_, err := time.Parse(time.RFC3339, dep.Annotations[annRunnerHandoffAt])
	return err == nil
}

// UNIT_BOUNDARY_DESCRIPTION: settles or stalls the owner's own hand-off, on the owner's turn and outside the roll lock, so the runner it calls holds up only this owner. It settles once the runner reports the release running, every machine that was ready before is ready again, stopped, or gone with its agent, and, if there were such machines, runnerHandoffObserve has passed without an ensure refused; a release the pod cannot take ends the hand-off too, since the pod roll that follows holds its own place. It stalls when the runner holds the release as failed, or when it has not settled within `rollout.settleTimeout`, less the time the release waited to be staged (runnerHandoffUnstagedRestart); an ensure the runner refuses stalls it from the agent's reconcile (stallRunnerHandoffOnEnsure).
func (r *AgentReconciler) settleRunnerHandoff(ctx context.Context, owner string, dep *appsv1.Deployment) {
	started, err := time.Parse(time.RFC3339, dep.Annotations[annRunnerHandoffAt])
	if err != nil || dep.Annotations[annRunnerHandoffStalled] != "" {
		return
	}
	settled, unstaged, trouble := r.runnerHandoffSettled(ctx, owner, dep, started)
	if unstaged && time.Since(started) > runnerHandoffUnstagedRestart {
		slog.Warn("vm runner: the release is not staged on the runner's node yet; the hand-off waits for the stager", "owner", owner, "release", dep.Annotations[annRunnerRelease], "handoffAt", dep.Annotations[annRunnerHandoffAt])
		dep.Annotations[annRunnerHandoffAt] = time.Now().UTC().Format(time.RFC3339)
		if err := r.updateRunnerDeployment(ctx, dep); err != nil {
			slog.Warn("vm runner: moving up the start of a hand-off waiting for its release to be staged", "runner", dep.Name, "error", err)
		}
		return
	}
	if settled {
		delete(dep.Annotations, annRunnerHandoffAt)
		delete(dep.Annotations, annRunnerHandoffAwaiting)
		if err := r.updateRunnerDeployment(ctx, dep); err != nil {
			slog.Warn("vm runner: clearing a settled hand-off", "runner", dep.Name, "error", err)
			return
		}
		r.resetRunnerRollView()
		return
	}
	if _, timeout := runnerRolloutLimits(r.config.VM.Runner); trouble == "" && !unstaged && time.Since(started) > timeout {
		trouble = "the runner did not settle on the release within the settle timeout of " + timeout.String()
	}
	if trouble != "" {
		r.stallRunnerHandoff(ctx, dep, trouble)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an owner with no ready machine has no agent reconcile to settle their hand-off, so it would hold its place until the next sweep, ten minutes on, and a release would reach one such owner per sweep. The sweep instead waits here, on its turn for the owner, until the runner has taken the release, the hand-off stalls, or one settle timeout has passed, which a hand-off waiting for its release to be staged outlasts; the next sweep follows that one again. The sweep runs as many such turns at once as the roll is wide, so the hand-offs it waits on are exactly the ones holding a place. A hand-off with ready machines is left to the owner's agents. The Deployment is read from the cache, which every hand-off write updates, so a poll costs the API server no read of it.
func (r *AgentReconciler) followIdleRunnerHandoff(ctx context.Context, owner string) {
	lock := r.ownerLock(owner)
	_, timeout := runnerRolloutLimits(r.config.VM.Runner)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		lock.Lock()
		dep, err := r.runnerDeployment(ctx, r.runnerName(owner), true)
		following := err == nil && dep.Annotations[annRunnerHandoffAt] != "" && dep.Annotations[annRunnerHandoffAwaiting] == "" && dep.Annotations[annRunnerHandoffStalled] == ""
		if following {
			r.settleRunnerHandoff(ctx, owner, dep)
			following = dep.Annotations[annRunnerHandoffAt] != ""
		}
		lock.Unlock()
		if !following {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(runnerHandoffFollowPoll):
		}
	}
}

func (r *AgentReconciler) runnerHandoffSettled(ctx context.Context, owner string, dep *appsv1.Deployment, started time.Time) (settled, unstaged bool, trouble string) {
	want, awaiting := dep.Annotations[annRunnerRelease], dep.Annotations[annRunnerHandoffAwaiting]
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return false, false, ""
	}
	release, err := client.Release(ctx)
	switch {
	case err != nil:
		return false, false, ""
	case release.Target == want && release.Held == vmrunner.HeldFailed:
		return false, false, "the runner holds the release as failed and went back to " + release.Running
	case release.Target == want && (release.Held == vmrunner.HeldRuntime || release.Held == vmrunner.HeldReboot):
		return true, false, ""
	case release.Target == want && release.Held == vmrunner.HeldUnstaged:
		return false, true, ""
	case release.Running != want && release.Target != want:
		if err := client.NameRelease(ctx, want); err != nil {
			slog.Warn("vm runner: naming the release to the runner again failed", "owner", owner, "error", err)
		}
		return false, false, ""
	case release.Running != want, awaiting != "" && time.Since(started) < runnerHandoffObserve:
		return false, false, ""
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
		return false, false, ""
	}
	return true, false, ""
}

func (r *AgentReconciler) stallRunnerHandoff(ctx context.Context, dep *appsv1.Deployment, trouble string) {
	slog.Error("vm runner: the hand-off to a new release is in trouble; the release is halted until a newer one is configured or the stall annotation is removed from the runner's Deployment",
		"owner", dep.Labels[envoyOwnerLabel], "release", dep.Annotations[annRunnerRelease], "handoffAt", dep.Annotations[annRunnerHandoffAt], "trouble", trouble, "annotation", annRunnerHandoffStalled)
	telemetry.RunnerHandoffStalled(ctx)
	delete(dep.Annotations, annRunnerHandoffAt)
	delete(dep.Annotations, annRunnerHandoffAwaiting)
	dep.Annotations[annRunnerHandoffStalled] = time.Now().UTC().Format(time.RFC3339)
	if err := r.updateRunnerDeployment(ctx, dep); err != nil {
		slog.Warn("vm runner: marking a stalled hand-off", "runner", dep.Name, "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an ensure the owner's runner refused while it is handing off to a new release is that release's trouble signal: a release that runs but cannot manage machines reports as running. A runner that cannot be reached, or answers that it is shutting down, is the hand-off itself, and a refused token is not the release's doing, so those do not count.
func (r *AgentReconciler) stallRunnerHandoffOnEnsure(ctx context.Context, owner string, err error) {
	var unreachable *vmrunner.UnreachableError
	if err == nil || r.config.VM.Runner.HostAddress != "" || errors.As(err, &unreachable) || errors.Is(err, vmrunner.ErrUnavailable) || errors.Is(err, vmrunner.ErrUnauthorized) {
		return
	}
	dep, getErr := r.runnerDeployment(ctx, r.runnerName(owner), true)
	if getErr != nil || dep.Annotations[annRunnerHandoffAt] == "" {
		return
	}
	r.stallRunnerHandoff(ctx, dep, "an ensure failed: "+err.Error())
}

// UNIT_BOUNDARY_DESCRIPTION: the runner pod as the roll compares it. Its memory limit is the owner's pool, and its memory request is clamped to that pool, and the controller changes both on the running pod in place, so both are left out: a UserBudget that raises or lowers the pool restarts no machine, and a pod created later takes the pool rendered then. The CPU limit the pod is created with and its zero CPU request are left out for the same reason, since the pod's limit is the pool's `cpu` too: a pool that changes only the CPU reaches the pod by that same resize. The pod's PriorityClass is left out as well: the chart sets it for every runner at once, so covering it would reboot every machine of every owner on the install that first set one, and a pod takes the class at its next replacement anyway. The pod's image is only the release it started with — the loader runs whichever one the controller names — so the image, and the env that tells the loader which release it is, are left out too: a new runner image alone changes no pod and restarts no machine.
func runnerRollSpec(spec appsv1.DeploymentSpec) appsv1.DeploymentSpec {
	spec = *spec.DeepCopy()
	spec.Template.Spec.PriorityClassName = ""
	for i := range spec.Template.Spec.Containers {
		c := &spec.Template.Spec.Containers[i]
		delete(c.Resources.Limits, corev1.ResourceMemory)
		delete(c.Resources.Requests, corev1.ResourceMemory)
		delete(c.Resources.Limits, corev1.ResourceCPU)
		delete(c.Resources.Requests, corev1.ResourceCPU)
		c.Image = ""
		for j := range c.Env {
			if c.Env[j].Name == vmRunnerBuiltinEnv {
				c.Env[j].Value = ""
			}
		}
	}
	return spec
}

// UNIT_BOUNDARY_DESCRIPTION: whether a runner pod whose shape is unchanged must still roll to take the configured release, and, when it must, whether the release is one whose machines must reboot onto it. A release the runner holds as rebooting does: it declares that the machines booted before it cannot take what it changes in place, so the hand-off leaves every running machine on what it booted, and the pod rolls and reboots them. So does a release whose runner does not load against this pod's libc, since its loader can never hand the machines to it. A runner that has not answered since it was named the release, for longer than a hand-off ever takes, rolls too; once it answers that it runs the release, or holds it as failed, that clock is cleared. A release that is merely not staged yet comes by itself, and one that failed right after it took over is left to the next release rather than rolled onto, since a pod on it would fail the same way and take the machines down with it. A runner that reports neither running nor targeting the release it was named has a pod that restarted and forgot it, and is named it again; one not named it yet is left to applyRunnerRelease, which names it only with a place in the roll. A pod on the configured image needs no roll: its own release is the one the install runs, and a release it could never take is refused rather than handed off, so what it runs is always the release it booted.
func (r *AgentReconciler) runnerNeedsPodForRelease(ctx context.Context, owner string, existing *appsv1.Deployment) (needs, reboots bool) {
	want := r.config.VM.Runner.Image
	containers := existing.Spec.Template.Spec.Containers
	if len(containers) == 0 {
		return false, false
	}
	if containers[0].Image == want {
		return false, false
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return false, false
	}
	release, err := client.Release(ctx)
	if err != nil {
		if at, perr := time.Parse(time.RFC3339, existing.Annotations[annRunnerReleaseNamedAt]); perr == nil && time.Since(at) > runnerReleaseUnreachableRoll {
			slog.Warn("vm runner: the runner has not answered since it was named a new release; rolling the pod", "owner", owner, "release", want, "error", err)
			return true, false
		}
		return false, false
	}
	if release.Target == want && release.Held == vmrunner.HeldFailed {
		r.clearRunnerReleaseNamed(ctx, owner, existing)
		slog.Warn("vm runner: the runner release exited right after it took over; the owner keeps the release it ran before", "owner", owner, "release", want, "running", release.Running)
		return false, false
	}
	if release.Running == want {
		r.clearRunnerReleaseNamed(ctx, owner, existing)
		return false, false
	}
	if release.Target != want {
		if existing.Annotations[annRunnerRelease] == want {
			if err := client.NameRelease(ctx, want); err != nil {
				slog.Warn("vm runner: naming the release to the runner again failed", "owner", owner, "error", err)
			}
		}
		return false, false
	}
	if release.Held == vmrunner.HeldReboot {
		slog.Info("vm runner: the release reboots the machines booted before it, so the pod rolls onto it instead of handing off", "owner", owner, "release", want, "running", release.Running)
		return true, true
	}
	return release.Held == vmrunner.HeldRuntime, false
}

// UNIT_BOUNDARY_DESCRIPTION: forgets when the runner's release was named, once the runner has answered with an outcome of the hand-off: that it runs the release, or that it holds it as failed and runs the one before. The stamp stands only for a hand-off whose outcome is not known yet; left in place, any later blip in such a runner — a crash and restart — would read as a hand-off that never came back and roll the pod, onto a release that failed in the second case. A runner that holds the release as rebooting keeps the stamp: its roll may find no free place for a while, and the stamp is what rolls the pod when a loader that hangs never takes the release it was named.
func (r *AgentReconciler) clearRunnerReleaseNamed(ctx context.Context, owner string, dep *appsv1.Deployment) {
	if dep.Annotations[annRunnerReleaseNamedAt] == "" {
		return
	}
	delete(dep.Annotations, annRunnerReleaseNamedAt)
	if err := r.updateRunnerDeployment(ctx, dep); err != nil {
		slog.Warn("vm runner: clearing the time its release was named", "owner", owner, "error", err)
	}
}
