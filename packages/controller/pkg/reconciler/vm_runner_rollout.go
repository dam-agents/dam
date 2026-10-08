package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
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

	defaultRunnerSettleTimeout = 10 * time.Minute

	// UNIT_BOUNDARY_DESCRIPTION: how long the list of runners mid-roll is reused. The rollout sweep offers every runner its turn, and each turn asks which others are mid-roll; listing every runner Deployment and asking each mid-roll runner about its machines on every turn is quadratic in owners. A roll this controller starts is added to the kept list at once, so the width still holds; what can be late is only a roll settling, by this much.
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

// UNIT_BOUNDARY_DESCRIPTION: a runner's machines are its processes, so every change to its pod reboots every machine the owner has. Applied as it is rendered, one runner image bump or one controller release that renders the pod differently would reboot every vm machine in the install at the same moment. So a runner is created at once, and left alone while what it would be rendered as is what it was, but a changed pod waits for a free place in the roll: at most `rollout.maxConcurrent` runners are mid-roll at once, and a runner stays mid-roll until its new pod is ready and every machine that was ready before the roll is ready again. The rendered spec is hashed onto the Deployment, because the stored spec carries the API server's defaults and never equals the rendered one. Where releases are staged on the node, a new runner image alone is not a changed pod (runnerRollSpec): the pod's loader takes it in place, and the pod rolls only for a release its loader can never take.
func (r *AgentReconciler) rollRunnerDeployment(ctx context.Context, owner string, dep *appsv1.Deployment, create bool) error {
	hash, err := runnerTemplateHash(runnerRollSpec(dep.Spec, r.config.VM.Runner.ReleaseHostPath != ""))
	if err != nil {
		return err
	}
	cli := r.client.AppsV1().Deployments(dep.Namespace)
	existing, err := cli.Get(ctx, dep.Name, metav1.GetOptions{})
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
	if existing.Annotations[annRunnerTemplate] == hash && !r.runnerNeedsPodForRelease(ctx, owner, existing) {
		return r.repairRunnerDeploymentMeta(ctx, owner, existing, dep)
	}

	r.runnerRollMu.Lock()
	defer r.runnerRollMu.Unlock()
	limit, _ := runnerRolloutLimits(r.config.VM.Runner)
	rolling, err := r.runnersMidRoll(ctx)
	if err != nil {
		return err
	}
	others := slices.DeleteFunc(slices.Clone(rolling), func(name string) bool { return name == dep.Name })
	if len(others) >= limit {
		slog.Info("vm runner: the pod changed, waiting for other runners to finish rolling", "owner", owner, "rolling", others)
		return nil
	}
	dep.Annotations = map[string]string{}
	for k, v := range existing.Annotations {
		dep.Annotations[k] = v
	}
	delete(dep.Annotations, annRunnerAwaiting)
	delete(dep.Annotations, annRunnerStalled)
	dep.Annotations[annRunnerTemplate] = hash
	dep.Annotations[annRunnerRolledAt] = time.Now().UTC().Format(time.RFC3339)
	if ready := r.readyMachines(ctx, owner); len(ready) > 0 {
		dep.Annotations[annRunnerAwaiting] = strings.Join(ready, ",")
	}
	dep.ResourceVersion, dep.Status = existing.ResourceVersion, existing.Status
	if _, err := cli.Update(ctx, dep, metav1.UpdateOptions{}); err != nil {
		return err
	}
	if !slices.Contains(rolling, dep.Name) {
		r.runnerRoll.rolling = append(rolling, dep.Name)
		sort.Strings(r.runnerRoll.rolling)
	}
	slog.Info("vm runner: rolling the pod", "owner", owner, "template", hash, "machines", dep.Annotations[annRunnerAwaiting])
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the pod is what the hash covers, so a runner whose pod is unchanged is not rolled — but its own labels and owner references can still drift, from a hand edit or from the runner ServiceAccount being recreated with a new UID, and a Deployment owned by nothing outlives the release. Those are put back with a metadata-only update, which does not change the pod and so restarts no machine. An owner reference the controller could not resolve this pass is not written, rather than stripping the one the runner has.
func (r *AgentReconciler) repairRunnerDeploymentMeta(ctx context.Context, owner string, existing, desired *appsv1.Deployment) error {
	if !repairRunnerMeta(&existing.ObjectMeta, desired.Labels, desired.OwnerReferences) {
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

// UNIT_BOUNDARY_DESCRIPTION: the runners still mid-roll. A runner that has settled has its roll annotations removed here, so the next pass reads it as settled without calling it again. A roll whose new pod became ready but whose machines did not all come back within `rollout.settleTimeout` stops holding its place: a machine whose agent stopped during the roll never comes back, and it must not stall every other owner's upgrade. A roll whose new pod never became ready keeps its place instead — a pod that does not start is a broken runner release, and letting the next owner roll would break them too — and is marked stalled, reported at error level and counted, once.
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
		if dep.Annotations[annRunnerRolledAt] == "" {
			continue
		}
		settled, stalled := r.runnerRollSettled(ctx, dep, timeout)
		if !settled {
			rolling = append(rolling, dep.Name)
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
			return false, true
		}
		slog.Warn("vm runner: the roll's machines did not all come back in time, the next runner may roll", "owner", owner, "timeout", timeout)
		return true, false
	}
	if !podReady {
		return false, false
	}
	awaiting := dep.Annotations[annRunnerAwaiting]
	if awaiting == "" {
		return true, false
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return false, false
	}
	for _, id := range strings.Split(awaiting, ",") {
		if st, err := client.Status(ctx, id); err == nil && st.Ready {
			continue
		}
		if _, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, id, metav1.GetOptions{}); k8serrors.IsNotFound(err) {
			continue
		}
		return false, false
	}
	return true, false
}

func runnerPodRolledOut(dep *appsv1.Deployment) bool {
	want := int32(1)
	if dep.Spec.Replicas != nil {
		want = *dep.Spec.Replicas
	}
	st := dep.Status
	return st.ObservedGeneration >= dep.Generation && st.Replicas == want && st.UpdatedReplicas == want && st.ReadyReplicas == want
}

// UNIT_BOUNDARY_DESCRIPTION: a changed runner pod is applied when one of that owner's agents reconciles, and a hibernated owner's agents may not reconcile for days. The sweep offers every runner its turn, in name order, so a roll reaches the whole install even where nothing else would ask. Each turn holds the owner's lock and only updates a runner that still exists, so it cannot race the orphan sweep into recreating a runner that sweep has just removed.
func (r *AgentReconciler) ReconcileRunnerRollout(ctx context.Context) {
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
	for i := range list.Items {
		owner := list.Items[i].Labels[envoyOwnerLabel]
		if owner == "" || list.Items[i].DeletionTimestamp != nil {
			continue
		}
		lock := r.ownerLock(owner)
		lock.Lock()
		err := r.applyRunnerDeployment(ctx, owner, refs, false)
		lock.Unlock()
		if err != nil && !errors.Is(err, errRunnerTerminating) {
			slog.Warn("vm runner rollout: applying a runner failed", "owner", owner, "error", err)
		}
	}
}
