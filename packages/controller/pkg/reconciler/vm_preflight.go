package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

type vmPreflightResult struct {
	problems []string
	warnings []string
}

// UNIT_BOUNDARY_DESCRIPTION: turning virtualization on asks an install to get several things right at once — a device plugin, the runner's identity, its memory limit, its egress ranges, the image budget — and each one gone wrong shows up only much later, as a vm agent that never becomes ready and a pod the operator has to read by hand. This check reads the install against the cluster when the controller starts and again on every pass, logs what it finds whenever that changes, and keeps the problems so that a vm agent's status names them. Problems are what stop any runner from working. Warnings are setups that run but are likely mistakes, such as an egress range that also reaches the cluster's own addresses; they are logged only, because an install may choose them on purpose.
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
	if spec.Resources != nil {
		limit := spec.Resources.Limits.Memory().Value() >> 20
		if limit > 0 && limit <= int64(spec.ReserveMiB) {
			res.problems = append(res.problems, fmt.Sprintf(
				"the runner's memory limit (%dMi) is no more than the %dMi it keeps for itself, so no machine ever fits (virtualization.runner.resources.limits.memory, reserveMiB)",
				limit, spec.ReserveMiB))
		}
	}
	for _, field := range []struct {
		name  string
		cidrs []string
	}{
		{"egressCidrs", spec.EgressCIDRs},
		{"egressExceptCidrs", spec.EgressExceptCIDRs},
		{"dnsCidrs", spec.DNSCIDRs},
	} {
		for _, c := range field.cidrs {
			if _, err := netip.ParsePrefix(c); err != nil {
				res.problems = append(res.problems, fmt.Sprintf("virtualization.runner.%s entry %q is not a CIDR", field.name, c))
			}
		}
	}

	res.problems = append(res.problems, r.preflightServiceAccount(ctx)...)
	if spec.HostAddress == "" {
		devProblems, devWarnings := r.preflightDevices(ctx)
		res.problems = append(res.problems, devProblems...)
		res.warnings = append(res.warnings, devWarnings...)
	}
	res.warnings = append(res.warnings, r.preflightEgressReach(ctx)...)
	dnsProblems, dnsWarnings := preflightRunnerDNS(spec)
	res.problems = append(res.problems, dnsProblems...)
	res.warnings = append(res.warnings, dnsWarnings...)
	res.warnings = append(res.warnings, preflightMetadataReach(spec)...)
	return res
}

// UNIT_BOUNDARY_DESCRIPTION: a confined runner that caches on its own claim resolves its registry only through the resolver the install names, and with none named every fetch fails on the name. That is a problem, not a warning, because no machine on such a runner can get an image. A resolver range of /0 is allowed but warned about, since it reopens port 53 to every address.
func preflightRunnerDNS(spec config.VMRunnerSpec) (problems, warnings []string) {
	if len(spec.EgressCIDRs) == 0 || !runnerOwnsImageCache(spec) {
		return nil, nil
	}
	if runnerDNSRule(spec) == nil {
		if runnerDNSPolicy(spec.DNSPolicy) == corev1.DNSClusterFirst {
			return []string{"the runner caches images on its own claim and resolves through the cluster DNS, but no DNS pods are selected, so it cannot resolve its registry (virtualization.runner.clusterDns)"}, nil
		}
		return []string{"the runner caches images on its own claim, but no resolver address is named, so it cannot resolve its registry (virtualization.runner.dnsCidrs)"}, nil
	}
	for _, c := range spec.DNSCIDRs {
		if p, err := netip.ParsePrefix(c); err == nil && p.Bits() == 0 {
			warnings = append(warnings, fmt.Sprintf("virtualization.runner.dnsCidrs entry %s admits DNS to every address, which an escaped guest can use as a channel to any host; name the node's resolver instead", c))
		}
	}
	return nil, warnings
}

// UNIT_BOUNDARY_DESCRIPTION: the controller subtracts the metadata endpoints from every egress block whatever the install wrote, so this does not report a hole — it reports values that do not say what the policy does: a wide block with no exception for link-local, which the values tell every install to write, and a block naming an endpoint itself, which is dropped. The single-address endpoints a few clouds add are subtracted without a word, since no install is asked to list them.
func preflightMetadataReach(spec config.VMRunnerSpec) []string {
	var out []string
	for _, c := range spec.EgressCIDRs {
		given := containedIn(c, spec.EgressExceptCIDRs)
		except, inside := exceptMetadata(c, given, metadataCIDRs)
		if inside {
			out = append(out, fmt.Sprintf("virtualization.runner.egressCidrs entry %s lies inside a cloud metadata range, which the runner may never reach, so it is not rendered", c))
			continue
		}
		var linkLocal []string
		for _, added := range except[len(given):] {
			if p, err := netip.ParsePrefix(added); err == nil && p.Addr().IsLinkLocalUnicast() {
				linkLocal = append(linkLocal, added)
			}
		}
		if len(linkLocal) > 0 {
			out = append(out, fmt.Sprintf("virtualization.runner.egressCidrs entry %s contains the link-local metadata range with no exception for it; the controller excepts %s itself — add it to egressExceptCidrs to say so", c, strings.Join(linkLocal, ", ")))
		}
	}
	return out
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

// UNIT_BOUNDARY_DESCRIPTION: the runner's egress ranges match in-cluster addresses too, so a wide range with no matching exception lets an escaped guest reach the platform's datastores. The controller cannot learn the cluster's pod and Service ranges reliably — no portable API names the pod range — but it knows one address inside each for certain: the API server's Service address it dials, and its own pod address. If either one is open to the runner, the install has almost certainly left the range around it open too. This is only a warning, because some installs keep a range open on purpose: an internal registry is reached by its Service address.
func (r *AgentReconciler) preflightEgressReach(ctx context.Context) []string {
	spec := r.config.VM.Runner
	var probes []struct{ what, ip string }
	if host, _, err := net.SplitHostPort(r.config.KubeAPIAddr); err == nil {
		probes = append(probes, struct{ what, ip string }{"the Service range (it holds the API server's address)", host})
	}
	if pod, err := r.client.CoreV1().Pods(r.config.ReleaseNamespace).Get(ctx, r.config.PodName, metav1.GetOptions{}); err == nil && pod.Status.PodIP != "" {
		probes = append(probes, struct{ what, ip string }{"the pod range (it holds the controller's address)", pod.Status.PodIP})
	}
	var out []string
	for _, p := range probes {
		addr, err := netip.ParseAddr(p.ip)
		if err != nil {
			continue
		}
		if block := openBlockFor(addr, spec.EgressCIDRs, spec.EgressExceptCIDRs); block != "" {
			out = append(out, fmt.Sprintf(
				"virtualization.runner.egressCidrs entry %s reaches %s (%s) with no exception covering it, so a runner can reach every pod or Service in that range; add the range to egressExceptCidrs unless that is intended",
				block, p.what, addr))
		}
	}
	return out
}

func openBlockFor(addr netip.Addr, cidrs, except []string) string {
	for _, c := range cidrs {
		block, err := netip.ParsePrefix(c)
		if err != nil || !block.Contains(addr) {
			continue
		}
		covered := false
		for _, e := range containedIn(c, except) {
			if sub, err := netip.ParsePrefix(e); err == nil && sub.Contains(addr) {
				covered = true
				break
			}
		}
		if !covered {
			return c
		}
	}
	return ""
}
