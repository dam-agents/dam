package reconciler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/intstr"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/pullauth"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: what tells anything inside the guest which backend it is on. It rides the machine's own environment rather than being set by platform-init, so a process started out of band — a shell over ssh, a harness restarted by hand — sees it too, and not only the exec chain that came from the entrypoint. agent-runtime reads it to know it has no cgroup to measure memory against, and the image's boot to know its HOME is a local disk rather than a network volume.
const vmBackendEnv = "PLATFORM_BACKEND"

const (
	// UNIT_BOUNDARY_DESCRIPTION: how soon an agent is reconciled again when
	// UNIT_BOUNDARY_DESCRIPTION: its runner could not be reached, which only a
	// UNIT_BOUNDARY_DESCRIPTION: full reconcile can fix, and how often every
	// UNIT_BOUNDARY_DESCRIPTION: vm agent is reconciled anyway. A machine on
	// UNIT_BOUNDARY_DESCRIPTION: its way up is watched by a long poll on its
	// UNIT_BOUNDARY_DESCRIPTION: runner instead; the health poll is the
	// UNIT_BOUNDARY_DESCRIPTION: backstop, and the only thing that notices a
	// UNIT_BOUNDARY_DESCRIPTION: ready guest going quiet.
	vmReadinessPoll = 3 * time.Second
	vmHealthPoll    = time.Minute

	vmGuestLocalCIDRs = "100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16"
)

var errLeafSecretPending = errors.New("envoy leaf TLS Secret not yet issued")

func (r *AgentReconciler) reconcileVMAgent(ctx context.Context, agent *apiv1.Agent, ownerRef metav1.OwnerReference, gatewayIP string, running bool) (vmrunner.MachineStatus, bool, error) {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	if owner == "" {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("agent %s has no owner label, so it has no VM runner", name)
	}
	demand, err := r.ownerRunnerDemand(ctx, owner, agent, running)
	if err != nil {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("sizing the owner's VM runner: %w", err)
	}
	runner, ready, err := r.ensureRunner(ctx, owner, demand)
	if err != nil {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("preparing the owner's VM runner: %w", err)
	}
	if !ready {
		msg := r.runnerNotReadyMessage(ctx, owner)
		if problems := r.vmPreflightProblems(); problems != "" {
			msg += "; this install cannot run VM runners as configured: " + problems
		}
		return vmrunner.MachineStatus{Message: msg}, false, nil
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
			return vmrunner.MachineStatus{}, false, fmt.Errorf("reading secretRef %s: %w", spec.SecretRef, err)
		}
		for k, v := range sec.Data {
			env[k] = string(v)
		}
	}
	env["IS_SANDBOX"] = "1"
	env[vmBackendEnv] = "vm"
	env["NO_PROXY"] += "," + vmGuestLocalCIDRs
	env["no_proxy"] = env["NO_PROXY"]

	storageGiB, err := resolveVMDiskGiB(spec, defaults)
	if err != nil {
		return vmrunner.MachineStatus{}, false, err
	}

	leaf, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, EnvoyLeafSecretName(name), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return vmrunner.MachineStatus{}, false, errLeafSecretPending
	}
	if err != nil {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("reading envoy leaf Secret: %w", err)
	}

	pullAuths, err := pullauth.Resolve(ctx, r.client.CoreV1().Secrets(r.config.Namespace),
		append([]string{spec.ImagePullSecretRef}, r.config.AgentBase.ImagePullSecrets...))
	if err != nil {
		return vmrunner.MachineStatus{}, false, err
	}

	cpu, _ := r.limitsOf(spec)
	machine := vmrunner.MachineSpec{
		Image:      spec.Image,
		CPUs:       max(int((cpu.MilliValue()+999)/1000), 1),
		MemoryMiB:  r.machineMemoryMiB(spec),
		StorageGiB: storageGiB,
		Env:        env,
		CACert:     string(leaf.Data["ca.crt"]),
		AllowCIDRs: []string{gatewayIP + "/32"},
		Revision:   agent.Annotations[annRollRev],
		Running:    running,
		PullAuths:  pullAuths,
	}
	st, err := runner.Ensure(ctx, name, machine)
	if err != nil {
		return st, false, err
	}

	if st.Port > 0 {
		if err := r.applyVMAgentService(ctx, name, owner, st.Port, ownerRef); err != nil {
			return st, false, fmt.Errorf("applying agent service: %w", err)
		}
	}
	if running && machineComingUp(st) {
		r.watchMachine(runner, name, st.Version)
	} else {
		r.unwatchMachine(name)
	}
	return st, true, nil
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

// UNIT_BOUNDARY_DESCRIPTION: an agent's machine lives on its owner's runner, so a delete that knows the owner goes to that runner alone, and an owner with no runner has no machine to delete. The runner's Deployment is read first, so an owner who never had a runner is not reported as an unreachable one. A delete with no owner, from an Agent whose labels the informer never saw, is offered to every runner, each of which ignores a machine it does not have. Anything a targeted delete misses, such as a machine left on a runner the Agent's owner label no longer names, is collected by the orphan sweep.
func (r *AgentReconciler) deleteMachine(ctx context.Context, name, owner string) {
	r.unwatchMachine(name)
	if !r.config.VM.Enabled {
		return
	}
	if owner == "" {
		r.deleteMachineEverywhere(ctx, name)
		return
	}
	_, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(owner), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return
	}
	if err != nil {
		slog.Warn("deleting machine: reading the owner's VM runner failed", "agent", name, "owner", owner, "error", err)
		return
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		slog.Warn("deleting machine: reaching the owner's VM runner failed", "agent", name, "owner", owner, "error", err)
		return
	}
	if err := client.Delete(ctx, name); err != nil {
		slog.Warn("deleting machine", "agent", name, "owner", owner, "error", err)
	}
}

func (r *AgentReconciler) deleteMachineEverywhere(ctx context.Context, name string) {
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
	r.unwatchMachine(name)
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

func (r *AgentReconciler) publishVMReadiness(ctx context.Context, agent *apiv1.Agent, st vmrunner.MachineStatus, runnerReached bool) error {
	msg := st.Message
	if !st.Ready && msg == "" {
		msg = "machine is " + st.State
	}
	if r.requeue != nil {
		poll := vmHealthPoll
		if !runnerReached {
			poll = vmReadinessPoll
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
	return r.publishReadinessOf(ctx, agent, st.Ready, reason, msg, runnerReached, st.Restarts, restartReason)
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

// UNIT_BOUNDARY_DESCRIPTION: a machine's storage is one disk holding one path, and that is the whole model. A pod attaches a volume per path, so on the container backend a mount is a size and a placement at once and the sizes were summed here — two 10Gi mounts bought 20Gi that either path could eat, each rounded up to a GiB of its own. A machine has a single disk, so the size is one quantity, rounded once, and the path is not configurable: HOME is fixed on both backends, every template in the chart persists it and nothing else, and a machine throws its whole root away when it stops. A mount that asks for anything else outside HOME is refused rather than dropped, because an agent whose work is silently discarded looks healthy until it stops. A size a persisted mount does declare raises the disk rather than being dropped — the container backend lets it win over the Agent's own storageSize, and a spec that asks for 50Gi there must not quietly get the chart's 10Gi here. Several of them take the largest and not the sum, because they are all nested inside the one path this backend keeps and a sum would size the disk for capacity no single mount could have claimed.
func resolveVMDiskGiB(spec *apiv1.AgentSpec, defaults config.AgentTemplateDefaults) (int, error) {
	for _, m := range resolveSpecMounts(spec, defaults) {
		if m.Persist && m.Path != agentHomeDir && !strings.HasPrefix(m.Path, agentHomeDir+"/") {
			return 0, fmt.Errorf("the vm backend persists only %s, so this Agent's persisted mount %s would be lost at the first stop; move it under %s or run this Agent on the container backend",
				agentHomeDir, m.Path, agentHomeDir)
		}
	}
	size := defaults.StorageSize
	if spec.StorageSize != "" {
		size = spec.StorageSize
	}
	quantity, err := resource.ParseQuantity(size)
	if err != nil {
		return 0, fmt.Errorf("the machine's disk size %q is not a quantity: %w", size, err)
	}
	for _, m := range resolveSpecMounts(spec, defaults) {
		if !m.Persist || m.Size == "" {
			continue
		}
		asked, err := resource.ParseQuantity(m.Size)
		if err != nil {
			return 0, fmt.Errorf("the size %q of the persisted mount %s is not a quantity: %w", m.Size, m.Path, err)
		}
		if asked.Value() > quantity.Value() {
			quantity = asked
		}
	}
	return max(int((quantity.Value()+(1<<30)-1)>>30), 1), nil
}
