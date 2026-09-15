package reconciler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/vmrunner"
)

const (
	vmPersistPathsEnv = "PLATFORM_VM_PERSIST_PATHS"
	vmReadinessPoll   = 3 * time.Second
	vmHealthPoll      = time.Minute
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
		return vmrunner.MachineStatus{State: vmrunner.StateCreating, Reason: vmrunner.ReasonNotReady, Message: "the owner's VM runner is still starting"}, nil
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

	var persist []string
	storageGiB := 0
	for _, m := range resolveSpecMounts(spec, defaults) {
		if !m.Persist {
			continue
		}
		persist = append(persist, m.Path)
		if q, err := resource.ParseQuantity(effectiveMountSize(m, spec, defaults)); err == nil {
			storageGiB += int((q.Value() + (1 << 30) - 1) >> 30)
		}
	}
	env[vmPersistPathsEnv] = strings.Join(persist, ",")

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
		StorageGiB: max(storageGiB, 1),
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

	svc := BuildAgentService(name, r.config, ownerRef)
	svc.Spec.Selector = nil
	svc.Spec.ClusterIP = ""
	if err := r.applyService(ctx, svc); err != nil {
		return st, fmt.Errorf("applying agent service: %w", err)
	}
	if st.Port > 0 {
		ip, err := r.runnerPodIP(ctx, owner)
		if err != nil {
			return st, err
		}
		if err := r.applyEndpointSlice(ctx, buildVMEndpointSlice(name, r.config.Namespace, ip, int32(st.Port), st.Ready, ownerRef)); err != nil {
			return st, fmt.Errorf("applying agent endpoint slice: %w", err)
		}
	}
	return st, nil
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
			_, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, id, metav1.GetOptions{})
			if err == nil {
				continue
			}
			if !k8serrors.IsNotFound(err) {
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
		if !anyVMAgent(agents.Items) {
			r.deleteRunner(ctx, runner.owner)
		}
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

func buildVMEndpointSlice(name, namespace, address string, port int32, ready bool, ownerRef metav1.OwnerReference) *discoveryv1.EndpointSlice {
	portName, tcp := "acp", corev1.ProtocolTCP
	return &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels: map[string]string{
				LabelAgent: name, LabelPair: name, LabelRole: RoleAgent,
				discoveryv1.LabelServiceName: name,
				discoveryv1.LabelManagedBy:   "platform-controller",
			},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Endpoints:   []discoveryv1.Endpoint{{Addresses: []string{address}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}}},
		Ports:       []discoveryv1.EndpointPort{{Name: &portName, Port: &port, Protocol: &tcp}},
	}
}

func (r *AgentReconciler) applyEndpointSlice(ctx context.Context, desired *discoveryv1.EndpointSlice) error {
	cli := r.client.DiscoveryV1().EndpointSlices(desired.Namespace)
	existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	desired.ResourceVersion = existing.ResourceVersion
	_, err = cli.Update(ctx, desired, metav1.UpdateOptions{})
	return err
}

func (r *AgentReconciler) publishVMReadiness(ctx context.Context, agent *apiv1.Agent, st vmrunner.MachineStatus) error {
	msg := st.Message
	if !st.Ready && msg == "" {
		msg = "machine is " + st.State
	}
	if r.requeue != nil {
		poll := vmHealthPoll
		if !st.Ready {
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
