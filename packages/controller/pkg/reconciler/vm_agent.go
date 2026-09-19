package reconciler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/intstr"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: what tells anything inside the guest which backend it is on. It rides the machine's own environment rather than being set by platform-init, so a process started out of band — a shell over ssh, a harness restarted by hand — sees it too, and not only the exec chain that came from the entrypoint. agent-runtime reads it to know it has no cgroup to measure memory against, and the image's boot to know its HOME is a local disk rather than a network volume.
const vmBackendEnv = "PLATFORM_BACKEND"

const (
	vmReadinessPoll = 3 * time.Second
	// UNIT_BOUNDARY_DESCRIPTION: how closely a machine is watched while it
	// UNIT_BOUNDARY_DESCRIPTION: starts, and for how long. The window runs
	// UNIT_BOUNDARY_DESCRIPTION: from the moment the runner asked the machine
	// UNIT_BOUNDARY_DESCRIPTION: to start, which it reports, and not from the
	// UNIT_BOUNDARY_DESCRIPTION: Ready condition's own transition: a wake
	// UNIT_BOUNDARY_DESCRIPTION: leaves that condition False and changes only
	// UNIT_BOUNDARY_DESCRIPTION: its reason, so the stamp does not move, and a
	// UNIT_BOUNDARY_DESCRIPTION: woken agent would be watched no more closely
	// UNIT_BOUNDARY_DESCRIPTION: than one stuck for hours — which is the case
	// UNIT_BOUNDARY_DESCRIPTION: this exists for.
	vmStartingPoll   = 500 * time.Millisecond
	vmStartingWindow = 20 * time.Second

	vmHealthPoll = time.Minute

	vmGuestLocalCIDRs = "100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16"
)

var errLeafSecretPending = errors.New("envoy leaf TLS Secret not yet issued")

func (r *AgentReconciler) reconcileVMAgent(ctx context.Context, agent *apiv1.Agent, ownerRef metav1.OwnerReference, gatewayIP string, running bool) (vmrunner.MachineStatus, error) {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	if owner == "" {
		return vmrunner.MachineStatus{}, fmt.Errorf("agent %s has no owner label, so it has no VM runner", name)
	}
	runner, ready, err := r.ensureRunner(ctx, owner)
	if err != nil {
		return vmrunner.MachineStatus{}, fmt.Errorf("preparing the owner's VM runner: %w", err)
	}
	if !ready {
		return vmrunner.MachineStatus{Message: r.runnerNotReadyMessage(ctx, owner)}, nil
	}
	spec := &agent.Spec
	defaults := r.config.AgentTemplateDefaults

	env := map[string]string{}
	for _, e := range agentPlatformEnv(name, r.config, agentHomeDir, agentProxyAddr(r.config, gatewayIP)) {
		env[e.Name] = e.Value
	}
	for _, e := range defaults.Env {
		env[e.Name] = e.Value
	}
	if spec.SecretRef != "" {
		sec, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, spec.SecretRef, metav1.GetOptions{})
		if err != nil {
			return vmrunner.MachineStatus{}, fmt.Errorf("reading secretRef %s: %w", spec.SecretRef, err)
		}
		for k, v := range sec.Data {
			env[k] = string(v)
		}
	}
	env["IS_SANDBOX"] = "1"
	env[vmBackendEnv] = "vm"
	env["NO_PROXY"] += "," + vmGuestLocalCIDRs
	env["no_proxy"] = env["NO_PROXY"]

	disk, err := resolveVMDisk(spec, defaults)
	if err != nil {
		return vmrunner.MachineStatus{}, err
	}

	leaf, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, EnvoyLeafSecretName(name), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return vmrunner.MachineStatus{}, errLeafSecretPending
	}
	if err != nil {
		return vmrunner.MachineStatus{}, fmt.Errorf("reading envoy leaf Secret: %w", err)
	}

	cpu, mem := r.limitsOf(spec)
	machine := vmrunner.MachineSpec{
		Image:      spec.Image,
		CPUs:       max(int((cpu.MilliValue()+999)/1000), 1),
		MemoryMiB:  max(int(mem.Value()>>20), 1),
		StorageGiB: disk.gibibytes,
		Persist:    disk.persist,
		Env:        env,
		CACert:     string(leaf.Data["ca.crt"]),
		AllowCIDRs: []string{gatewayIP + "/32"},
		Revision:   agent.Annotations[annRollRev],
		Running:    running,
	}
	st, err := runner.Ensure(ctx, name, machine)
	if err != nil {
		return st, err
	}

	if st.Port > 0 {
		if err := r.applyVMAgentService(ctx, name, owner, st.Port, ownerRef); err != nil {
			return st, fmt.Errorf("applying agent service: %w", err)
		}
		r.dropSupersededEndpointSlice(ctx, name)
	}
	return st, nil
}

// UNIT_BOUNDARY_DESCRIPTION: an earlier release wrote this Service's endpoint by hand, under the agent's own name. Kubernetes now keeps one of its own for the same Service, and two slices naming one Service are unioned — so a leftover that once read ready, pointing at an address its machine no longer answers on, would take a share of the traffic and nothing would repair it. Delete is enough: the generated slice carries a suffixed name, so only the hand-written one matches. Remove this once no cluster has reconciled a vm agent under the old mechanism.
func (r *AgentReconciler) dropSupersededEndpointSlice(ctx context.Context, name string) {
	err := r.client.DiscoveryV1().EndpointSlices(r.config.Namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil && !k8serrors.IsNotFound(err) {
		slog.Warn("removing the endpoint slice an earlier release wrote by hand", "agent", name, "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent has no pod, so its Service selects the owner's runner and maps the agent port onto the one that machine publishes there — which needs a ClusterIP, since a headless Service hands back the pod address without remapping the port. Selecting works only because the runner shares this namespace; a selector never reaches across one. It is applied rather than created once, because the published port moves when a machine is recreated.
func (r *AgentReconciler) applyVMAgentService(ctx context.Context, name, owner string, port int, ownerRef metav1.OwnerReference) error {
	desired := BuildAgentService(name, r.config, ownerRef)
	desired.Spec.ClusterIP = ""
	desired.Spec.Selector = vmRunnerSelector(owner)
	desired.Spec.Ports[0].TargetPort = intstr.FromInt(port)

	cli := r.client.CoreV1().Services(r.config.Namespace)
	existing, err := cli.Get(ctx, name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	existing.Spec.Selector = desired.Spec.Selector
	existing.Spec.Ports = desired.Spec.Ports
	_, err = cli.Update(ctx, existing, metav1.UpdateOptions{})
	return err
}

func (r *AgentReconciler) ReconcileOrphanMachines(ctx context.Context) {
	if !r.config.VM.Enabled {
		return
	}
	runners, err := r.knownRunners(ctx)
	if err != nil {
		slog.Warn("orphan machine GC: listing VM runners failed", "error", err)
		return
	}
	for _, runner := range runners {
		ids, err := runner.client.List(ctx)
		if err != nil {
			slog.Warn("orphan machine GC: listing machines failed", "owner", runner.owner, "error", err)
			continue
		}
		for _, id := range ids {
			agent, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, id, metav1.GetOptions{})
			if err == nil {
				if agent.GetLabels()[envoyOwnerLabel] == runner.owner {
					continue
				}
			} else if !k8serrors.IsNotFound(err) {
				slog.Warn("orphan machine GC: API lookup failed", "agent", id, "error", err)
				continue
			}
			if err := runner.client.Delete(ctx, id); err != nil {
				slog.Warn("orphan machine GC: delete failed", "machine", id, "error", err)
				continue
			}
			slog.Info("orphan machine GC: deleted machine for missing agent", "machine", id)
		}
		agents, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: envoyOwnerLabel + "=" + runner.owner,
		})
		if err != nil {
			slog.Warn("orphan machine GC: listing the owner's agents failed", "owner", runner.owner, "error", err)
			continue
		}
		if anyVMAgent(agents.Items) {
			continue
		}
		left, err := runner.client.List(ctx)
		if err != nil || len(left) > 0 {
			slog.Info("orphan machine GC: runner kept, it is not empty", "owner", runner.owner, "machines", len(left), "error", err)
			continue
		}
		r.deleteRunner(ctx, runner.owner)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an agent's machine lives on its owner's runner, and a delete arrives with only the agent's name — so it is offered to every runner, each of which ignores a machine it does not have.
func (r *AgentReconciler) deleteMachineEverywhere(ctx context.Context, name string) {
	if !r.config.VM.Enabled {
		return
	}
	runners, err := r.knownRunners(ctx)
	if err != nil {
		slog.Warn("deleting machine: listing VM runners failed", "agent", name, "error", err)
		return
	}
	for _, runner := range runners {
		if err := runner.client.Delete(ctx, name); err != nil {
			slog.Warn("deleting machine", "agent", name, "owner", runner.owner, "error", err)
		}
	}
}

func (r *AgentReconciler) HaltMachine(ctx context.Context, owner, name string) error {
	if !r.config.VM.Enabled || owner == "" {
		return nil
	}
	agent, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return nil
		}
		return err
	}
	if !anyVMAgent([]unstructured.Unstructured{*agent}) {
		return nil
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return err
	}
	if _, err := client.Ensure(ctx, name, vmrunner.MachineSpec{Running: false}); err != nil {
		return fmt.Errorf("stopping machine for %s: %w", name, err)
	}
	return nil
}

func (r *AgentReconciler) publishVMReadiness(ctx context.Context, agent *apiv1.Agent, st vmrunner.MachineStatus) error {
	msg := st.Message
	if !st.Ready && msg == "" {
		msg = "machine is " + st.State
	}
	if r.requeue != nil {
		poll := vmHealthPoll
		if !st.Ready && (st.Reason == "" || st.Reason == vmrunner.ReasonNotReady) {
			poll = vmReadinessPoll
			starting := time.Duration(st.StartingMs) * time.Millisecond
			if st.State == vmrunner.StateCreating || st.State == vmrunner.StateStarting || (starting > 0 && starting < vmStartingWindow) {
				poll = vmStartingPoll
			}
		}
		r.requeue(agent.Name, poll)
	}
	reason := st.Reason
	if reason == "" {
		reason = vmrunner.ReasonNotReady
	}
	restartReason := ""
	if st.Restarts > 0 {
		restartReason = "GuestStoppedAnswering"
	}
	return r.publishReadinessOf(ctx, agent, st.Ready, reason, msg, st.Restarts, restartReason)
}

func anyVMAgent(items []unstructured.Unstructured) bool {
	for i := range items {
		backend, _, _ := unstructured.NestedString(items[i].Object, "spec", "backend", "type")
		if backend == "vm" {
			return true
		}
	}
	return false
}

type vmDisk struct {
	gibibytes int
	persist   []string
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's storage is one disk and a set of paths on it, which is why the vm backend states it separately from Mounts. A pod attaches one volume per path, so on the container backend a mount is a size and a placement at once; a machine has a single disk, so summing the mounts' sizes produced a number no path was held to — two 10Gi mounts bought 20Gi that either path could eat — and rounding each one up to a GiB first paid for that rounding once per mount. The size is one quantity here, rounded once. An Agent written without the block still boots: its persisted mounts name the paths and its own storage size is the disk, which is what the default template already meant.
func resolveVMDisk(spec *apiv1.AgentSpec, defaults config.AgentTemplateDefaults) (vmDisk, error) {
	declared := spec.Backend.VM.GetDisk()
	size := defaults.StorageSize
	if spec.StorageSize != "" {
		size = spec.StorageSize
	}
	if declared != nil && declared.Size != "" {
		size = declared.Size
	}
	quantity, err := resource.ParseQuantity(size)
	if err != nil {
		return vmDisk{}, fmt.Errorf("the machine's disk size %q is not a quantity: %w", size, err)
	}

	var persist []string
	if declared != nil {
		persist = slices.Clone(declared.Persist)
	} else {
		for _, m := range resolveSpecMounts(spec, defaults) {
			if m.Persist {
				persist = append(persist, m.Path)
			}
		}
	}
	persist = outermost(persist)

	return vmDisk{
		gibibytes: max(int((quantity.Value()+(1<<30)-1)>>30), 1),
		persist:   persist,
	}, nil
}

// UNIT_BOUNDARY_DESCRIPTION: one disk persists a path and everything under it, so a declared path inside another is already covered by its parent and binding it again would mount the parent's own subtree onto itself. Mounts may nest — each is a volume of its own on the container backend, and a template that nested two has always been legal — so the nesting is resolved here rather than refused, and the list is sorted so that reordering it is not a restart.
func outermost(paths []string) []string {
	slices.Sort(paths)
	paths = slices.Compact(paths)
	kept := paths[:0]
	for _, path := range paths {
		if len(kept) > 0 && strings.HasPrefix(path, kept[len(kept)-1]+"/") {
			continue
		}
		kept = append(kept, path)
	}
	return kept
}
