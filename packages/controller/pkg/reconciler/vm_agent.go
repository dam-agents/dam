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
	"k8s.io/apimachinery/pkg/labels"
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
	vmReadinessPoll   = 3 * time.Second
	vmNotReadyPollMax = time.Minute
	vmHealthPoll      = time.Minute

	vmGuestLocalCIDRs = "100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16"

	// UNIT_BOUNDARY_DESCRIPTION: the address a guest reaches its host at: smolvm's own gateway address, which it relays to the host's loopback. A runner outside the cluster has the guest's proxy there, on the port its gateway is forwarded to. contract/guest.json holds both sides to it.
	vmHostGatewayAddress = "100.96.0.1"
)

var errLeafSecretPending = errors.New("envoy leaf TLS Secret not yet issued")

// UNIT_BOUNDARY_DESCRIPTION: ensures the Agent's machine on its owner's runner. `publish` points the agent Service at the machine; a machine a runtime migration builds beside a container that still serves leaves the Service to the container.
func (r *AgentReconciler) reconcileVMAgent(ctx context.Context, agent *apiv1.Agent, ownerRef metav1.OwnerReference, gatewayIP string, running, publish bool) (vmrunner.MachineStatus, bool, error) {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	if owner == "" {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("agent %s has no owner label, so it has no VM runner", name)
	}
	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()
	demand, err := r.ownerRunnerDemand(ctx, owner, agent, running)
	if err != nil {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("sizing the owner's VM runner: %w", err)
	}
	runner, ready, err := r.ensureRunner(ctx, owner, demand)
	if errors.Is(err, errRunnerTerminating) {
		return vmrunner.MachineStatus{Message: "the owner's previous VM runner is still being removed; a new one is created once it is gone"}, false, nil
	}
	if err != nil {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("preparing the owner's VM runner: %w", err)
	}
	if !ready {
		reason, msg := r.runnerNotReady(ctx, owner)
		if problems := r.vmPreflightProblems(); problems != "" {
			msg += "; this install cannot run VM runners as configured: " + problems
		}
		return vmrunner.MachineStatus{Reason: reason, Message: msg}, false, nil
	}
	spec := &agent.Spec
	defaults := r.config.AgentTemplateDefaults

	proxy, allow, gatewayHostPort := agentProxyAddr(r.config, gatewayIP), []string{gatewayIP + "/32"}, 0
	if r.config.VM.Runner.HostAddress != "" {
		if gatewayHostPort, err = r.exposeGatewayOnHost(ctx, name); err != nil {
			return vmrunner.MachineStatus{}, false, fmt.Errorf("exposing the gateway to the host runner: %w", err)
		}
		proxy, allow = fmt.Sprintf("http://%s:%d", vmHostGatewayAddress, gatewayHostPort), nil
	}
	env := map[string]string{}
	for _, e := range agentPlatformEnv(name, r.config, agentHomeDir, proxy) {
		env[e.Name] = e.Value
	}
	for _, e := range defaults.Env {
		env[e.Name] = e.Value
	}
	sec, err := r.ownedSecretRef(ctx, agent)
	var refused secretRefRefused
	if errors.As(err, &refused) {
		sec, err = nil, nil
	}
	if err != nil {
		return vmrunner.MachineStatus{}, false, err
	}
	if sec != nil {
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
		Image:           spec.Image,
		CPUs:            max(int((cpu.MilliValue()+999)/1000), 1),
		MemoryMiB:       r.machineMemoryMiB(spec),
		StorageGiB:      storageGiB,
		Env:             env,
		CACert:          string(leaf.Data["ca.crt"]),
		AllowCIDRs:      allow,
		GatewayHostPort: gatewayHostPort,
		Revision:        agent.Annotations[annRollRev],
		Running:         running,
		PullAuths:       pullAuths,
		ExpectSeed:      runtimeMigrationExpectSeed(agent),
	}
	if runtimeMigrationOf(agent.Annotations, agent.Status).seedable() {
		machine.Migration = &vmrunner.MachineMigration{}
	}
	st, err := runner.Ensure(ctx, name, machine)
	if err != nil {
		return st, false, err
	}

	if publish && st.Port > 0 {
		if err := r.applyVMAgentService(ctx, name, owner, st.Port, ownerRef); err != nil {
			return st, false, fmt.Errorf("applying agent service: %w", err)
		}
	}
	if running && !st.Ready && (st.Reason == "" || st.Reason == vmrunner.ReasonNotReady) {
		r.watchMachine(runner, name, st.Version)
	} else {
		r.unwatchMachine(name)
	}
	return st, true, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a runner outside the cluster reaches the machine's gateway through a NodePort, which the local cluster's VM forwards to that host's loopback. Kubernetes picks the port, so it is read back from the Service rather than chosen here, and a gateway that is already a NodePort keeps the port it has.
func (r *AgentReconciler) exposeGatewayOnHost(ctx context.Context, agentName string) (int, error) {
	cli := r.client.CoreV1().Services(r.config.Namespace)
	svc, err := cli.Get(ctx, GatewayName(agentName), metav1.GetOptions{})
	if err != nil {
		return 0, err
	}
	if svc.Spec.Type != corev1.ServiceTypeNodePort {
		svc.Spec.Type = corev1.ServiceTypeNodePort
		if svc, err = cli.Update(ctx, svc, metav1.UpdateOptions{}); err != nil {
			return 0, err
		}
	}
	return int(svc.Spec.Ports[0].NodePort), nil
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent has no pod, so its Service selects the owner's runner and maps the agent port onto the one that machine publishes there — which needs a ClusterIP, since a headless Service hands back the pod address without remapping the port. Selecting works only because the runner shares this namespace; a selector never reaches across one. It is applied rather than created once, because the published port moves when a machine is recreated.
func (r *AgentReconciler) applyVMAgentService(ctx context.Context, name, owner string, port int, ownerRef metav1.OwnerReference) error {
	desired := BuildAgentService(name, r.config, ownerRef)
	desired.Spec.ClusterIP = ""
	desired.Spec.Selector = vmRunnerSelector(owner)
	desired.Spec.Ports[0].TargetPort = intstr.FromInt(port)
	if r.config.VM.Runner.HostAddress != "" {
		desired.Spec.Selector = nil
		if err := r.applyHostRunnerEndpoints(ctx, desired, port); err != nil {
			return err
		}
	}

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

// UNIT_BOUNDARY_DESCRIPTION: a runner outside the cluster is no pod a selector can find, so the agent's Service has no selector and this slice names the runner's address and the machine's published port instead. The slice is the Service's own: it carries the Service's name label, which is how kube-proxy joins the two, and a managed-by value of its own, so the EndpointSlice controller leaves it alone.
func (r *AgentReconciler) applyHostRunnerEndpoints(ctx context.Context, svc *corev1.Service, port int) error {
	desired := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:            svc.Name,
			Namespace:       svc.Namespace,
			OwnerReferences: svc.OwnerReferences,
			Labels: map[string]string{
				discoveryv1.LabelServiceName: svc.Name,
				discoveryv1.LabelManagedBy:   "platform-controller",
			},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Endpoints:   []discoveryv1.Endpoint{{Addresses: []string{r.config.VM.Runner.HostAddress}}},
		Ports: []discoveryv1.EndpointPort{{
			Name:     &svc.Spec.Ports[0].Name,
			Port:     new(int32(port)),
			Protocol: new(corev1.ProtocolTCP),
		}},
	}
	cli := r.client.DiscoveryV1().EndpointSlices(svc.Namespace)
	existing, err := cli.Get(ctx, svc.Name, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	existing.Endpoints, existing.Ports = desired.Endpoints, desired.Ports
	_, err = cli.Update(ctx, existing, metav1.UpdateOptions{})
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: how long a runner that cannot be reached, and whose owner has no Agent of any kind, is kept before the sweep removes it anyway. Only an agent's reconcile creates a runner, so such a runner serves nobody; the grace covers a runner that is merely restarting while its owner's Agents are being recreated.
const orphanRunnerGrace = 30 * time.Minute

func (r *AgentReconciler) ReconcileOrphanMachines(ctx context.Context) {
	if !r.config.VM.Enabled {
		return
	}
	if r.config.VM.Runner.HostAddress != "" {
		r.sweepHostRunner(ctx)
		return
	}
	runners, err := r.knownRunners(ctx)
	if err != nil {
		slog.Warn("orphan machine GC: listing VM runners failed", "error", err)
		return
	}
	for _, runner := range runners {
		r.sweepRunner(ctx, runner)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the whole pass over one runner holds the owner's lock, which an agent's reconcile also holds while it builds the runner and ensures its machine. What the sweep reads — the owner's Agents in a fresh List and in the informer cache, and the runner's own machine list — therefore cannot change under it through this controller, and a runner is removed only when all of them still say it serves nobody. A machine is collected when no Agent of this owner has its name: an Agent of the same name that belongs to someone else says nothing about this runner.
func (r *AgentReconciler) sweepRunner(ctx context.Context, runner runnerRef) {
	owner := runner.owner
	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()

	agents, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: envoyOwnerLabel + "=" + owner,
	})
	if err != nil {
		slog.Warn("orphan machine GC: listing the owner's agents failed", "owner", owner, "error", err)
		return
	}
	var ids []string
	if runner.client != nil {
		ids, err = runner.client.List(ctx)
	}
	if runner.client == nil || err != nil {
		r.collectUnreachableRunner(ctx, owner, len(agents.Items), err)
		return
	}
	r.ownerless.Delete(owner)
	claimed := map[string]bool{}
	for i := range agents.Items {
		claimed[agents.Items[i].GetName()] = true
	}
	for _, id := range ids {
		if claimed[id] {
			continue
		}
		if err := runner.client.Delete(ctx, id); err != nil {
			slog.Warn("orphan machine GC: delete failed", "machine", id, "owner", owner, "error", err)
			continue
		}
		slog.Info("orphan machine GC: deleted machine for missing agent", "machine", id, "owner", owner)
	}
	if anyVMAgent(agents.Items) || r.cachedOwnerAgents(ctx, owner, true) > 0 {
		return
	}
	left, err := runner.client.List(ctx)
	if err != nil || len(left) > 0 {
		slog.Info("orphan machine GC: runner kept, it is not empty", "owner", owner, "machines", len(left), "error", err)
		return
	}
	r.deleteRunner(ctx, owner)
}

// UNIT_BOUNDARY_DESCRIPTION: a runner outside the cluster serves every owner and is never removed, so the sweep only collects machines no Agent names. The machines are listed before the Agents: an Agent exists before its machine does, so every machine in the first list has its Agent in the second, and one created in between is simply not looked at yet.
func (r *AgentReconciler) sweepHostRunner(ctx context.Context) {
	runner, err := r.runnerFor(ctx, "")
	if err != nil {
		slog.Warn("orphan machine GC: the host VM runner cannot be reached", "error", err)
		return
	}
	ids, err := runner.List(ctx)
	if err != nil {
		slog.Warn("orphan machine GC: listing the host VM runner's machines failed", "error", err)
		return
	}
	agents, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("orphan machine GC: listing agents failed", "error", err)
		return
	}
	claimed := map[string]bool{}
	for i := range agents.Items {
		claimed[agents.Items[i].GetName()] = true
	}
	for _, id := range ids {
		if claimed[id] {
			continue
		}
		if err := runner.Delete(ctx, id); err != nil {
			slog.Warn("orphan machine GC: delete failed", "machine", id, "error", err)
			continue
		}
		slog.Info("orphan machine GC: deleted machine for missing agent", "machine", id)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a runner the sweep cannot ask what it holds is kept while its owner has any Agent at all. One whose owner has none is kept for the grace, then removed with whatever its disk still holds — it is reported at error level, because that is the one path where the platform deletes a claim it could not see into.
func (r *AgentReconciler) collectUnreachableRunner(ctx context.Context, owner string, listed int, cause error) {
	if listed > 0 || r.cachedOwnerAgents(ctx, owner, false) > 0 {
		r.ownerless.Delete(owner)
		slog.Warn("orphan machine GC: the owner's VM runner cannot be reached, it is kept", "owner", owner, "error", cause)
		return
	}
	first, _ := r.ownerless.LoadOrStore(owner, time.Now())
	since := time.Since(first.(time.Time))
	if since < orphanRunnerGrace {
		slog.Warn("orphan machine GC: a VM runner that cannot be reached serves no agent; it is removed if that lasts", "owner", owner, "for", since.Round(time.Second), "grace", orphanRunnerGrace, "error", cause)
		return
	}
	slog.Error("orphan machine GC: removing a VM runner that cannot be reached and whose owner has no agents; its claim is deleted unseen", "owner", owner, "for", since.Round(time.Second), "error", cause)
	r.deleteRunner(ctx, owner)
}

// UNIT_BOUNDARY_DESCRIPTION: the owner's Agents as the informer sees them, counted as a second opinion beside a fresh List: either one knowing of an Agent keeps the runner.
func (r *AgentReconciler) cachedOwnerAgents(ctx context.Context, owner string, vmOnly bool) int {
	items, err := r.ownerAgents(ctx, owner)
	if err != nil {
		return 1
	}
	n := 0
	for _, obj := range items {
		u, ok := obj.(*unstructured.Unstructured)
		if !ok {
			n++
			continue
		}
		if !vmOnly || anyVMAgent([]unstructured.Unstructured{*u}) {
			n++
		}
	}
	return n
}

// UNIT_BOUNDARY_DESCRIPTION: an agent's machine lives on its owner's runner, so a delete that knows the owner goes to that runner alone, and an owner with no runner has no machine to delete. The runner's Deployment is read first, so an owner who never had a runner is not reported as an unreachable one. A delete with no owner, from an Agent whose labels the informer never saw, is offered to every runner, each of which ignores a machine it does not have. Anything a targeted delete misses, such as a machine left on a runner the Agent's owner label no longer names, is collected by the orphan sweep.
func (r *AgentReconciler) deleteMachine(ctx context.Context, name, owner string) error {
	r.unwatchMachine(name)
	if !r.config.VM.Enabled {
		return nil
	}
	if owner == "" && r.config.VM.Runner.HostAddress == "" {
		return r.deleteMachineEverywhere(ctx, name)
	}
	if r.config.VM.Runner.HostAddress == "" {
		_, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(owner), metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reading the owner's VM runner: %w", err)
		}
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return fmt.Errorf("reaching the owner's VM runner: %w", err)
	}
	if err := client.Delete(ctx, name); err != nil {
		return fmt.Errorf("deleting the machine: %w", err)
	}
	return nil
}

func (r *AgentReconciler) deleteMachineEverywhere(ctx context.Context, name string) error {
	runners, err := r.knownRunners(ctx)
	if err != nil {
		return fmt.Errorf("listing VM runners: %w", err)
	}
	var errs []error
	for _, runner := range runners {
		if runner.client == nil {
			continue
		}
		if err := runner.client.Delete(ctx, name); err != nil {
			errs = append(errs, fmt.Errorf("owner %s: %w", runner.owner, err))
		}
	}
	return errors.Join(errs...)
}

// UNIT_BOUNDARY_DESCRIPTION: the vm agents of one owner, from the informer cache, for requeueing them when their runner's Deployment changes — its pod becoming ready is what they are waiting for, and nothing about the Agents themselves changes then.
func (r *AgentReconciler) OwnerVMAgents(owner string) []string {
	if r.agentCache == nil || owner == "" {
		return nil
	}
	items, err := r.agentCache.ByNamespace(r.config.Namespace).List(labels.SelectorFromSet(labels.Set{envoyOwnerLabel: owner}))
	if err != nil {
		return nil
	}
	var names []string
	for _, obj := range items {
		if u, ok := obj.(*unstructured.Unstructured); ok && anyVMAgent([]unstructured.Unstructured{*u}) {
			names = append(names, u.GetName())
		}
	}
	return names
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
		if runnerReached {
			r.notReadyPolls.Delete(agent.Name)
		} else {
			poll = r.nextNotReadyPoll(agent.Name)
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

// UNIT_BOUNDARY_DESCRIPTION: an agent whose runner is not ready yet is looked at again after 3s, then twice as long each time up to a minute. A runner that never comes up — unschedulable, a pull that fails — would otherwise cost a full reconcile of every one of its owner's agents every three seconds; the runner Deployment's own changes requeue them the moment it does become ready.
func (r *AgentReconciler) nextNotReadyPoll(name string) time.Duration {
	n := 0
	if v, ok := r.notReadyPolls.Load(name); ok {
		n = v.(int)
	}
	poll := vmReadinessPoll << n
	if poll >= vmNotReadyPollMax {
		return vmNotReadyPollMax
	}
	r.notReadyPolls.Store(name, n+1)
	return poll
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent cannot start until cert-manager has issued its gateway's leaf and its owner's runner certificate, and a Certificate that is not issuing says why only on itself. The wait is put on the Agent's readiness, with cert-manager's account when it gives one, so the owner sees what the agent waits for instead of a status that never moves.
func (r *AgentReconciler) publishCertificateWait(ctx context.Context, agent *apiv1.Agent, pending error) {
	cert, what := EnvoyLeafSecretName(agent.Name), "the gateway's TLS certificate"
	if errors.Is(pending, errRunnerTLSPending) {
		cert, what = r.runnerTLSName(agent.Labels[envoyOwnerLabel]), "the owner's VM runner's TLS certificate"
	}
	msg := "waiting for cert-manager to issue " + what
	if detail := r.certificateNotReady(ctx, cert); detail != "" {
		msg += ": " + detail
	}
	gen := agent.Generation
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", vmrunner.ReasonNotReady, msg, gen)
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", "PodsNotReady", "", gen)
	}); err != nil {
		slog.Warn("writing the certificate wait onto the agent", "agent", agent.Name, "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a machine that could not be ensured is not known to be ready, so the failed reconcile takes Ready and AgentPodReady down with it rather than leaving the last success standing. A runner that could not be reached is described without its address; the dial error goes to the log.
func (r *AgentReconciler) setMachineError(ctx context.Context, agent *apiv1.Agent, cause error) error {
	var unreachable *vmrunner.UnreachableError
	if errors.As(cause, &unreachable) {
		slog.Warn("vm machine: the owner's VM runner could not be reached", "agent", agent.Name, "owner", agent.Labels[envoyOwnerLabel], "error", unreachable.Unwrap())
	}
	msg := fmt.Sprintf("reconciling vm machine: %v", cause)
	gen := agent.Generation
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", vmrunner.ReasonNotReady, msg, gen)
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", "PodsNotReady", "", gen)
	}); err != nil {
		slog.Warn("writing agent machine-error status", "agent", agent.Name, "error", err)
	}
	return r.setError(ctx, agent.Name, msg)
}

func anyVMAgent(items []unstructured.Unstructured) bool {
	for i := range items {
		backend, _, _ := unstructured.NestedString(items[i].Object, "spec", "backend", "type")
		if backend == "vm" || items[i].GetAnnotations()[annRuntimeMigration] != "" {
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
