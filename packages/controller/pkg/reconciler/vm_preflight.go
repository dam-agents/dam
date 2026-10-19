package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

type vmPreflightResult struct {
	problems []string
	warnings []string
}

// UNIT_BOUNDARY_DESCRIPTION: turning virtualization on asks an install to get several things right at once — a device plugin, the runner's identity, its memory limit, the image cache — and each one gone wrong shows up only much later, as a vm agent that never becomes ready and a pod the operator has to read by hand. This check reads the install against the cluster when the controller starts and again on every pass, logs what it finds whenever that changes, and keeps the problems so that a vm agent's status names them. Problems are what stop any runner from working. Warnings are what the controller cannot check, such as nodes it may not list; they are logged only.
func (r *AgentReconciler) CheckVMInstall(ctx context.Context) {
	if !r.config.VM.Enabled {
		return
	}
	result := r.vmPreflight(ctx)
	r.preflightMu.Lock()
	changed := !r.preflightDone || !slices.Equal(result.problems, r.preflight.problems) || !slices.Equal(result.warnings, r.preflight.warnings)
	r.preflight, r.preflightDone = result, true
	r.preflightMu.Unlock()
	if !changed {
		return
	}
	if len(result.problems) == 0 && len(result.warnings) == 0 {
		slog.Info("vm preflight: this install can run VM runners")
	}
	for _, p := range result.problems {
		slog.Error("vm preflight: this install cannot run VM runners", "problem", p)
	}
	for _, w := range result.warnings {
		slog.Warn("vm preflight", "warning", w)
	}
}

func (r *AgentReconciler) vmPreflightProblems() string {
	r.preflightMu.Lock()
	defer r.preflightMu.Unlock()
	return strings.Join(r.preflight.problems, "; ")
}

func (r *AgentReconciler) vmPreflight(ctx context.Context) vmPreflightResult {
	var res vmPreflightResult
	spec := r.config.VM.Runner

	if _, err := imageBudgetBytes(spec); err != nil {
		res.problems = append(res.problems, err.Error()+" (virtualization.imageCache.budget)")
	}
	if _, err := resource.ParseQuantity(spec.Storage); err != nil {
		res.problems = append(res.problems, fmt.Sprintf("the runner's storage %q is not a quantity (virtualization.runner.storage)", spec.Storage))
	}
	if spec.ImageCacheHostPath == "" && spec.HostAddress == "" {
		res.problems = append(res.problems, "no node directory is named for the image cache, so no runner has an image to boot (virtualization.imageCache.hostPath)")
	}
	if spec.Resources != nil {
		limit := spec.Resources.Limits.Memory().Value() >> 20
		if limit > 0 && limit <= int64(spec.ReserveMiB) {
			res.problems = append(res.problems, fmt.Sprintf(
				"the runner's memory limit (%dMi) is no more than the %dMi it keeps for itself, so no machine ever fits (virtualization.runner.resources.limits.memory, reserveMiB)",
				limit, spec.ReserveMiB))
		}
	}

	res.problems = append(res.problems, r.preflightServiceAccount(ctx)...)
	if spec.HostAddress == "" {
		devProblems, devWarnings := r.preflightDevices(ctx)
		res.problems = append(res.problems, devProblems...)
		res.warnings = append(res.warnings, devWarnings...)
	}
	return res
}

func (r *AgentReconciler) preflightServiceAccount(ctx context.Context) []string {
	name := r.config.VM.Runner.ServiceAccountName
	if name == "" {
		return []string{"no runner ServiceAccount is configured, so runner pods have no identity to run as"}
	}
	_, err := r.client.CoreV1().ServiceAccounts(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return []string{fmt.Sprintf("the runner ServiceAccount %s/%s does not exist, so no runner pod can be created", r.config.Namespace, name)}
	}
	if err != nil {
		return []string{fmt.Sprintf("cannot read the runner ServiceAccount %s/%s: %v", r.config.Namespace, name, err)}
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: a runner gets /dev/kvm and /dev/net/tun only as device-plugin resources, so an install whose plugin is missing, disabled or named differently leaves every runner pod pending on a resource no node will ever publish. A node counts only if it matches the runner's node selector and is schedulable. Taints are not checked: the scheduler's own message says when a toleration is missing. A controller that may not list nodes cannot tell, and says so as a warning rather than refusing an install it cannot see.
func (r *AgentReconciler) preflightDevices(ctx context.Context) (problems, warnings []string) {
	spec := r.config.VM.Runner
	if len(spec.Devices) == 0 {
		return []string{"no device resources are configured for the runner, so it cannot reach /dev/kvm (virtualization.runner.devices)"}, nil
	}
	want := corev1.ResourceList{}
	for name, v := range spec.Devices {
		q, err := resource.ParseQuantity(v)
		if err != nil {
			problems = append(problems, fmt.Sprintf("device %s: %q is not a quantity (virtualization.runner.devices)", name, v))
			continue
		}
		want[corev1.ResourceName(name)] = q
	}
	if len(problems) > 0 {
		return problems, nil
	}
	nodes, err := r.client.CoreV1().Nodes().List(ctx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(spec.NodeSelector).String(),
	})
	if err != nil {
		return nil, []string{fmt.Sprintf("cannot list nodes to check that one advertises the runner's devices: %v", err)}
	}
	for i := range nodes.Items {
		n := &nodes.Items[i]
		if !n.Spec.Unschedulable && hasResources(n.Status.Allocatable, want) {
			return nil, nil
		}
	}
	names := make([]string, 0, len(want))
	for name := range want {
		names = append(names, string(name))
	}
	slices.Sort(names)
	where := "no schedulable node"
	if len(spec.NodeSelector) > 0 {
		where = "no schedulable node matching virtualization.runner.nodeSelector"
	}
	return []string{fmt.Sprintf(
		"%s advertises %s, so every runner pod would pend: run a KVM device plugin on the cluster (KubeVirt, or e.g. squat's generic-device-plugin) and name the resources it publishes in virtualization.runner.devices",
		where, strings.Join(names, " and "))}, nil
}

func hasResources(have, want corev1.ResourceList) bool {
	for name, q := range want {
		got, ok := have[name]
		if !ok || got.Cmp(q) < 0 {
			return false
		}
	}
	return true
}
