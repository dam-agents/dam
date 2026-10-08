package reconciler

import (
	"context"
	"log/slog"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const runnerReleaseKey = "release"

func (r *AgentReconciler) runnerReleaseName(owner string) string {
	return r.runnerName(owner) + "-release"
}

// UNIT_BOUNDARY_DESCRIPTION: names the runner release an owner's runner pod should run: the runner image this controller is configured with. The pod's loader reads it from the mounted ConfigMap and hands the machines to that release once the node's stager has staged it, so a new runner image reaches every owner without a pod restart. The ConfigMap is owned by the runner's Deployment, so it goes wherever the Deployment goes.
func (r *AgentReconciler) applyRunnerRelease(ctx context.Context, owner string) error {
	ns, name, release := r.config.Namespace, r.runnerReleaseName(owner), r.config.VM.Runner.Image
	dep, err := r.client.AppsV1().Deployments(ns).Get(ctx, r.runnerName(owner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	cms := r.client.CoreV1().ConfigMaps(ns)
	existing, err := cms.Get(ctx, name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = cms.Create(ctx, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:            name,
				Namespace:       ns,
				Labels:          vmRunnerLabels(owner, r.config.ReleaseName),
				OwnerReferences: []metav1.OwnerReference{*metav1.NewControllerRef(dep, appsv1.SchemeGroupVersion.WithKind("Deployment"))},
			},
			Data: map[string]string{runnerReleaseKey: release},
		}, metav1.CreateOptions{})
		return err
	}
	if err != nil || existing.Data[runnerReleaseKey] == release {
		return err
	}
	existing.Data = map[string]string{runnerReleaseKey: release}
	_, err = cms.Update(ctx, existing, metav1.UpdateOptions{})
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: the runner pod as the roll compares it. With releases staged on the node, the pod's image is only the release it started with — the loader runs whichever one the controller names — so the image, and the env that tells the loader which release it is, are left out: a new runner image alone changes no pod and restarts no machine.
func runnerRollSpec(spec appsv1.DeploymentSpec, releases bool) appsv1.DeploymentSpec {
	if !releases {
		return spec
	}
	spec = *spec.DeepCopy()
	for i := range spec.Template.Spec.Containers {
		c := &spec.Template.Spec.Containers[i]
		c.Image = ""
		for j := range c.Env {
			if c.Env[j].Name == vmRunnerBuiltinEnv {
				c.Env[j].Value = ""
			}
		}
	}
	return spec
}

// UNIT_BOUNDARY_DESCRIPTION: whether a runner pod whose shape is unchanged must still roll to take the configured release. Only a release built for another pod needs a new one — its runner does not load against this pod's libc, or the install keeps one VM runtime per pod — since its loader can never hand the machines to it. A release that is merely not staged yet comes by itself, and one that failed right after it took over is left to the next release rather than rolled onto, since a pod on it would fail the same way and take the machines down with it.
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
	if err != nil || release.Running == want || release.Target != want {
		return false
	}
	switch release.Held {
	case vmrunner.HeldRuntime:
		return true
	case vmrunner.HeldFailed:
		slog.Warn("vm runner: the runner release exited right after it took over; the owner keeps the release it ran before", "owner", owner, "release", want, "running", release.Running)
	}
	return false
}
