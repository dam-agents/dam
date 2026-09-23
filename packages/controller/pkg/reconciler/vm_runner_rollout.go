package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	annRunnerTemplate = "agent-platform.ai/runner-template"
	annRunnerRolledAt = "agent-platform.ai/runner-rolled-at"
	annRunnerAwaiting = "agent-platform.ai/runner-awaiting"

	defaultRunnerSettleTimeout = 10 * time.Minute
	defaultRunnerRollRecheck   = 15 * time.Second
)

// UNIT_BOUNDARY_DESCRIPTION: the last answer to "is the roll full". A runner waiting its turn reaches the gate on every reconcile of its owner's agents, and a starting machine requeues every half second — so without this, each of those passes would list every runner and call another owner's runner about each machine it is waiting for. A full roll stays full for at least one machine boot, so the answer is kept for `recheck` and only then asked again.
type runnerRollGate struct {
	checkedAt time.Time
	full      bool
	recheck   time.Duration
}

func (g *runnerRollGate) stillFull(now time.Time) bool {
	recheck := g.recheck
	if recheck <= 0 {
		recheck = defaultRunnerRollRecheck
	}
	return g.full && now.Sub(g.checkedAt) < recheck
}

// UNIT_BOUNDARY_DESCRIPTION: an owner is a canary when the install names them, or when their bucket falls under the canary percentage. The bucket is a hash of the owner label and nothing else, so it is the same on every reconcile and every controller replica, and raising the percentage only adds owners: an owner who is a canary at 10 stays one at 20.
func isCanaryOwner(owner string, canary config.VMRunnerCanary) bool {
	if slices.Contains(canary.Owners, owner) {
		return true
	}
	sum := sha256.Sum256([]byte("canary/" + owner))
	return binary.BigEndian.Uint64(sum[:8])%100 < uint64(max(canary.Percent, 0))
}

func runnerImage(spec config.VMRunnerSpec, owner string) string {
	if spec.CanaryImage != "" && isCanaryOwner(owner, spec.Canary) {
		return spec.CanaryImage
	}
	return spec.Image
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

// UNIT_BOUNDARY_DESCRIPTION: a runner's machines are its processes, so every change to its pod reboots every machine the owner has. Applied as it is rendered, one runner image bump or one controller release that renders the pod differently would reboot every vm machine in the install at the same moment. So a runner is created at once, and left alone while what it would be rendered as is what it was, but a changed pod waits for a free place in the roll: at most `rollout.maxConcurrent` runners are mid-roll at once, and a runner stays mid-roll until its new pod is ready and every machine that was ready before the roll is ready again. The rendered spec is hashed onto the Deployment, because the stored spec carries the API server's defaults and never equals the rendered one.
func (r *AgentReconciler) rollRunnerDeployment(ctx context.Context, owner string, dep *appsv1.Deployment) error {
	hash, err := runnerTemplateHash(dep.Spec)
	if err != nil {
		return err
	}
	cli := r.client.AppsV1().Deployments(dep.Namespace)
	existing, err := cli.Get(ctx, dep.Name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		dep.Annotations = map[string]string{annRunnerTemplate: hash}
		_, err = cli.Create(ctx, dep, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	if existing.Annotations[annRunnerTemplate] == hash {
		return r.adoptRunnerObject(ctx, &existing.ObjectMeta, func() error {
			_, err := cli.Update(ctx, existing, metav1.UpdateOptions{})
			return err
		})
	}

	r.runnerRollMu.Lock()
	defer r.runnerRollMu.Unlock()
	if r.runnerRollGate.stillFull(time.Now()) {
		return nil
	}
	limit, _ := runnerRolloutLimits(r.config.VM.Runner)
	rolling, err := r.runnersMidRoll(ctx, dep.Name)
	if err != nil {
		return err
	}
	r.runnerRollGate.checkedAt, r.runnerRollGate.full = time.Now(), len(rolling) >= limit
	if r.runnerRollGate.full {
		slog.Info("vm runner: the pod changed, waiting for other runners to finish rolling", "owner", owner, "rolling", rolling)
		return nil
	}
	r.runnerRollGate.full = len(rolling)+1 >= limit
	dep.Annotations = map[string]string{}
	for k, v := range existing.Annotations {
		dep.Annotations[k] = v
	}
	delete(dep.Annotations, annRunnerAwaiting)
	dep.Annotations[annRunnerTemplate] = hash
	dep.Annotations[annRunnerRolledAt] = time.Now().UTC().Format(time.RFC3339)
	if ready := r.readyMachines(ctx, owner); len(ready) > 0 {
		dep.Annotations[annRunnerAwaiting] = strings.Join(ready, ",")
	}
	dep.ResourceVersion, dep.Status = existing.ResourceVersion, existing.Status
	if _, err := cli.Update(ctx, dep, metav1.UpdateOptions{}); err != nil {
		return err
	}
	slog.Info("vm runner: rolling the pod", "owner", owner, "template", hash, "machines", dep.Annotations[annRunnerAwaiting])
	return nil
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

// UNIT_BOUNDARY_DESCRIPTION: the runners still mid-roll, other than the one asking. A runner that has settled has its roll annotations removed here, so the next pass reads it as settled without calling it again. A roll that has not settled within `rollout.settleTimeout` stops holding its place: a machine whose agent stopped during the roll never comes back, and it must not stall every other owner's upgrade.
func (r *AgentReconciler) runnersMidRoll(ctx context.Context, except string) ([]string, error) {
	cli := r.client.AppsV1().Deployments(r.config.Namespace)
	list, err := cli.List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + vmRunnerComponent})
	if err != nil {
		return nil, err
	}
	_, timeout := runnerRolloutLimits(r.config.VM.Runner)
	var rolling []string
	for i := range list.Items {
		dep := &list.Items[i]
		if dep.Name == except || dep.Annotations[annRunnerRolledAt] == "" {
			continue
		}
		if !r.runnerRollSettled(ctx, dep, timeout) {
			rolling = append(rolling, dep.Name)
			continue
		}
		delete(dep.Annotations, annRunnerRolledAt)
		delete(dep.Annotations, annRunnerAwaiting)
		if _, err := cli.Update(ctx, dep, metav1.UpdateOptions{}); err != nil {
			slog.Warn("vm runner: clearing a settled roll", "runner", dep.Name, "error", err)
		}
	}
	sort.Strings(rolling)
	return rolling, nil
}

func (r *AgentReconciler) runnerRollSettled(ctx context.Context, dep *appsv1.Deployment, timeout time.Duration) bool {
	owner := dep.Labels[envoyOwnerLabel]
	rolledAt, err := time.Parse(time.RFC3339, dep.Annotations[annRunnerRolledAt])
	if err != nil {
		return true
	}
	if time.Since(rolledAt) > timeout {
		slog.Warn("vm runner: the roll did not settle in time, the next runner may roll", "owner", owner, "timeout", timeout)
		return true
	}
	if !runnerPodRolledOut(dep) {
		return false
	}
	awaiting := dep.Annotations[annRunnerAwaiting]
	if awaiting == "" {
		return true
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return false
	}
	for _, id := range strings.Split(awaiting, ",") {
		if st, err := client.Status(ctx, id); err == nil && st.Ready {
			continue
		}
		if _, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, id, metav1.GetOptions{}); k8serrors.IsNotFound(err) {
			continue
		}
		return false
	}
	return true
}

func runnerPodRolledOut(dep *appsv1.Deployment) bool {
	want := int32(1)
	if dep.Spec.Replicas != nil {
		want = *dep.Spec.Replicas
	}
	st := dep.Status
	return st.ObservedGeneration >= dep.Generation && st.Replicas == want && st.UpdatedReplicas == want && st.ReadyReplicas == want
}

// UNIT_BOUNDARY_DESCRIPTION: a changed runner pod is applied when one of that owner's agents reconciles, and a hibernated owner's agents may not reconcile for days. The sweep offers every runner its turn, in name order, so a roll reaches the whole install even where nothing else would ask.
func (r *AgentReconciler) ReconcileRunnerRollout(ctx context.Context) {
	if !r.config.VM.Enabled {
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
	for i := range list.Items {
		owner := list.Items[i].Labels[envoyOwnerLabel]
		if owner == "" || list.Items[i].DeletionTimestamp != nil {
			continue
		}
		if err := r.applyRunnerDeployment(ctx, owner); err != nil {
			slog.Warn("vm runner rollout: applying a runner failed", "owner", owner, "error", err)
		}
	}
}
