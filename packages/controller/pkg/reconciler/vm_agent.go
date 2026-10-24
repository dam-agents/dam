package reconciler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
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
	// UNIT_BOUNDARY_DESCRIPTION: full reconcile can fix, and how often a vm
	// UNIT_BOUNDARY_DESCRIPTION: agent that is not ready is reconciled anyway. A
	// UNIT_BOUNDARY_DESCRIPTION: machine's status, on its way up, failed, or
	// UNIT_BOUNDARY_DESCRIPTION: running and ready, is watched by a long poll on
	// UNIT_BOUNDARY_DESCRIPTION: its runner instead, so a settled agent is
	// UNIT_BOUNDARY_DESCRIPTION: reconciled only when something changes; the
	// UNIT_BOUNDARY_DESCRIPTION: health poll is the backstop for what has not
	// UNIT_BOUNDARY_DESCRIPTION: reached a status a watch can hold.
	vmReadinessPoll   = 3 * time.Second
	vmNotReadyPollMax = time.Minute
	vmHealthPoll      = time.Minute
	// UNIT_BOUNDARY_DESCRIPTION: how long a start may wait for the node to report what it granted before the wait is published as a state of its own. It sits well inside the api-server's 120 s wake, whose clock starts before the controller's hold does, so the named state is published before that final read rather than after it; a node that has not answered in a minute of three-second retries is not merely late.
	grantUnreadableBound = 60 * time.Second
	// UNIT_BOUNDARY_DESCRIPTION: how often an unreadable grant is asked about with a resize, since the API server validates one against what the node supports and the answer cannot change between two asks a few seconds apart.
	grantProbeInterval = 30 * time.Second
	// UNIT_BOUNDARY_DESCRIPTION: the ceiling sent on an ensure for a machine that already holds memory: enough to authorize nothing, so a runner that is told to boot the machine refuses, and small enough that no boot is ever under it.
	grantHeldMiB = 1

	vmGuestLocalCIDRs = "100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16"

	// UNIT_BOUNDARY_DESCRIPTION: the address a guest reaches its host at: smolvm's own gateway address, which it relays to the host's loopback. A runner outside the cluster has the guest's proxy there, on the port its gateway is forwarded to. contract/guest.json holds both sides to it.
	vmHostGatewayAddress = "100.96.0.1"
)

var errLeafSecretPending = errors.New("envoy leaf TLS Secret not yet issued")

// UNIT_BOUNDARY_DESCRIPTION: the runner took the stop but the guest is still being signalled, quiesced and powered off. The runner answers a stop at once, so a machine reads stopped only on a later status.
var errMachineStopping = errors.New("the machine is still stopping")

// UNIT_BOUNDARY_DESCRIPTION: ensures the Agent's machine on its owner's runner and points the Agent's Service at it, so the api-server dials a machine exactly as it dialled a pod.
func (r *AgentReconciler) reconcileVMAgent(ctx context.Context, agent *apiv1.Agent, ownerRef metav1.OwnerReference, gatewayIP string, running bool) (vmrunner.MachineStatus, bool, error) {
	name, spec := agent.Name, &agent.Spec
	owner := agent.Labels[envoyOwnerLabel]
	if owner == "" {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("agent %s has no owner label, so it has no VM runner", name)
	}
	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()
	// UNIT_BOUNDARY_DESCRIPTION: the pool is cached and the memory pass reads it again only for owners with something running, so a pool changed while every machine slept would size this start from the old one, and a size reaches a machine only at its next start: the reconcile that starts a machine reads the UserBudget again.
	if was, _ := r.vmRunning.Swap(name, running); running && was != true {
		r.refreshVMPool(ctx, owner)
	}
	demand, err := r.ownerRunnerDemand(ctx, owner, agent, running)
	if err != nil {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("sizing the owner's VM runner: %w", err)
	}
	var (
		runner                   *vmrunner.Client
		ready                    bool
		sec, leaf                *corev1.Secret
		pullAuths                []string
		secErr, leafErr, pullErr error
	)
	// UNIT_BOUNDARY_DESCRIPTION: what the machine spec reads from the cluster does not depend on the runner, so it is read beside the runner's preparation rather than after it: each is a few serial API reads on every reconcile of a waking machine. A runner that is not ready or not reached still wins over a missing leaf, as it did when these came after it.
	_ = concurrently(
		func() error { runner, ready, err = r.ensureRunner(ctx, owner); return nil },
		func() error { sec, secErr = r.ownedSecretRef(ctx, agent); return nil },
		func() error {
			leaf, leafErr = r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, EnvoyLeafSecretName(name), metav1.GetOptions{})
			if k8serrors.IsNotFound(leafErr) {
				leaf, leafErr = r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, ownerGatewayName(r.config.ReleaseName, owner)+ownerGatewayLeafSuffix, metav1.GetOptions{})
			}
			return nil
		},
		func() error {
			pullAuths, pullErr = pullauth.Resolve(ctx, r.client.CoreV1().Secrets(r.config.Namespace),
				append([]string{spec.ImagePullSecretRef}, r.config.AgentBase.ImagePullSecrets...))
			return nil
		},
	)
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
	// UNIT_BOUNDARY_DESCRIPTION: the owner gateway is rendered after the runner call, still under the owner's lock: a machine reaches its gateway through its own Service's address whichever pod that selects, so a start never waits for the owner's render, a few reads and writes per agent of the owner.
	if r.ownerGatewayServes() {
		defer func() {
			if _, err := r.ensureOwnerGateway(ctx, owner); err != nil {
				slog.Warn("owner gateway: not applied", "owner", owner, "agent", name, "error", err)
			}
		}()
	}
	defaults := r.config.AgentTemplateDefaults

	proxy, allow, gatewayHostPort, resolver := agentProxyAddr(r.config, gatewayIP), []string{gatewayIP + "/32"}, 0, gatewayIP
	if r.config.VM.Runner.HostAddress != "" {
		if gatewayHostPort, err = r.exposeGatewayOnHost(ctx, name); err != nil {
			return vmrunner.MachineStatus{}, false, fmt.Errorf("exposing the gateway to the host runner: %w", err)
		}
		proxy, allow, resolver = fmt.Sprintf("http://%s:%d", vmHostGatewayAddress, gatewayHostPort), nil, ""
	}
	env := map[string]string{}
	for _, e := range agentPlatformEnv(name, r.config, agentHomeDir, proxy) {
		env[e.Name] = e.Value
	}
	for _, e := range defaults.Env {
		env[e.Name] = e.Value
	}
	if spec.Harness != "" {
		env["PLATFORM_HARNESS"] = spec.Harness
	}
	var refused secretRefRefused
	if errors.As(secErr, &refused) {
		sec = nil
	} else if secErr != nil {
		return vmrunner.MachineStatus{}, false, secErr
	}
	if sec != nil {
		for k, v := range sec.Data {
			env[k] = string(v)
		}
	}
	env["IS_SANDBOX"] = "1"
	env[vmBackendEnv] = "vm"
	env[requireConnectionAddressEnv] = requireConnectionAddressValue(spec)
	if spec.EnvironmentOf != "" {
		env[environmentOfEnv] = spec.EnvironmentOf
	} else {
		delete(env, environmentOfEnv)
	}
	env["NO_PROXY"] += "," + vmGuestLocalCIDRs
	env["no_proxy"] = env["NO_PROXY"]

	legacyGiB, err := resolveVMDiskGiB(spec, defaults)
	if err != nil {
		return vmrunner.MachineStatus{}, false, err
	}
	storageGiB := r.machineDiskGiB(ctx, runner, owner, agent.Name, legacyGiB)

	if k8serrors.IsNotFound(leafErr) {
		return vmrunner.MachineStatus{}, false, errLeafSecretPending
	}
	if leafErr != nil {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("reading envoy leaf Secret: %w", leafErr)
	}
	if pullErr != nil {
		return vmrunner.MachineStatus{}, false, pullErr
	}
	// UNIT_BOUNDARY_DESCRIPTION: a machine that should stop is sized from its spec when the pool cannot be read, and takes no admission ceiling either. A stop acts on no size, and refusing it would leave a machine up that the controller asked to stop, holding everything the stop releases.
	memoryMiB, err := r.machineMemoryMiB(ctx, owner, spec)
	if err != nil && running {
		return vmrunner.MachineStatus{}, false, fmt.Errorf("sizing the machine: %w", err)
	}
	admitMiB, err := r.runnerAdmitMiB(ctx, owner)
	if err != nil && running && !errors.Is(err, errGrantUnknown) {
		return vmrunner.MachineStatus{}, false, err
	}
	if err != nil && running {
		// UNIT_BOUNDARY_DESCRIPTION: an unreadable grant never stops or shrinks a machine that holds memory, and what a machine holds is only ever the runner's current answer: the controller's cache is kept from the last running reading, so a machine that exited since would read as holding memory and its cold start would be admitted against the whole pool. One the runner reports booting, running, restarting or stopping is admitted against the limit alone, as a restart is, since its boot replaces memory it already holds and no new footprint is asked for. Only a start the runner reports holding nothing waits.
		live, statusErr := runner.Status(ctx, name)
		switch {
		case statusErr != nil:
			// UNIT_BOUNDARY_DESCRIPTION: a failed read is no evidence either way, and acting on it is how a restart in flight becomes a stop: the answer returns without parking, so the Agent keeps its gateway and the restart the runner already performs, and the reconcile is retried.
			return vmrunner.MachineStatus{}, false, fmt.Errorf("reading the state of %s to admit it against a node that has not reported its grant: %w", name, statusErr)
		case holdsMemory(live.State):
			admitMiB = r.holdInFlight(owner, name)
			r.grantHolds.Delete(name)
		case live.State == vmrunner.StateUnknown:
			// UNIT_BOUNDARY_DESCRIPTION: the runner says it cannot read the machine's own record, which is a machine that may still hold its memory: absence of an active state is not proof of a stop, so this is retried rather than held, parked or admitted.
			return vmrunner.MachineStatus{}, false, fmt.Errorf("the runner cannot read the record of %s, so whether it holds memory is unknown and it may not be admitted against a node that has not reported its grant", name)
		default:
			return r.holdUnreadableGrant(ctx, owner, name, demand, live.State), false, nil
		}
	}
	r.grantHolds.Delete(name)

	machine := vmrunner.MachineSpec{
		Image:                spec.Image,
		CPUs:                 max(r.config.VM.Runner.MachineCPUs, 1),
		MemoryMiB:            memoryMiB,
		StorageGiB:           storageGiB,
		Env:                  env,
		CACert:               machineTrustedCAs(string(leaf.Data["ca.crt"]), r.config),
		AllowCIDRs:           allow,
		GatewayHostPort:      gatewayHostPort,
		GuestResolver:        resolver,
		Revision:             agent.Annotations[annRollRev],
		Running:              running,
		PullAuths:            pullAuths,
		NestedVirtualization: wantsNesting(agent, r.config.AgentTemplateDefaults) && r.config.VM.Runner.NestedVirtualization,
		AdmitMiB:             admitMiB,
	}
	st, err := runner.Ensure(ctx, name, machine)
	r.stallRunnerHandoffOnEnsure(ctx, owner, err)
	if err == nil && running {
		// UNIT_BOUNDARY_DESCRIPTION: the answer is kept whether it refused or admitted the machine: the Agent's status carries a refusal one reconcile late, and a machine that is still booting is not yet a live machine to count by.
		r.vmAnswers.Store(name, answerReason(st))
		if refusedAnswer(st) {
			// UNIT_BOUNDARY_DESCRIPTION: a refusal leaves the machine holding nothing, so the pod is sized for what the owner holds and not for the start the runner refused, or the next reconcile of any other agent would raise it again.
			if held, heldErr := r.heldRunnerDemand(ctx, owner, agent, running); heldErr == nil {
				demand = held
			}
		} else if sized, sizedErr := r.ownerRunnerDemand(ctx, owner, agent, running); sizedErr == nil {
			// UNIT_BOUNDARY_DESCRIPTION: a start the runner admitted changes what the owner holds, and the request it is sized from has to be the answer after that: sized from the read taken before the ensure, the next pass would ask for the whole demand again and the wave after it would step back down, resizing the pod on every admission.
			demand = sized
		}
	}
	if err == nil && st.DiskGiB > 0 {
		r.vmDiskGrows.Store(name, true)
	}
	if r.config.VM.Runner.HostAddress == "" {
		// UNIT_BOUNDARY_DESCRIPTION: the step down's grace is recorded here, from the same demand the pod is sized from, so every reconcile maintains it: the reclaim below reads it only while a resize is pending, and a wave the node granted reaches that read never.
		r.noteSteppedAsk(ctx, owner, demand)
		r.resizeRunnerPod(ctx, owner, demand)
	}
	// UNIT_BOUNDARY_DESCRIPTION: the runner's Service is headless, so its name resolves only once the ready pod's endpoint is published and the cluster DNS has read it, which trails the Deployment's ready count by a few seconds. A fresh runner, an owner's first vm agent, is dialled inside that gap; it is still starting, not failing, so the agent waits on it rather than going into error.
	var unresolved *net.DNSError
	if errors.As(err, &unresolved) {
		return vmrunner.MachineStatus{Reason: vmrunner.ReasonNotReady, Message: "the owner's VM runner is still starting: its address does not resolve yet"}, false, nil
	}
	if err != nil {
		return st, false, err
	}
	r.watchRunnerPressure(runner, owner)

	if st.Port > 0 {
		if err := r.applyVMAgentService(ctx, name, owner, st.Port, ownerRef); err != nil {
			return st, false, fmt.Errorf("applying agent service: %w", err)
		}
	}
	// UNIT_BOUNDARY_DESCRIPTION: a machine the kernel or its seccomp filter killed is watched as a boot, its reason saying why it went down rather than that the attempt failed: the runner's next boot of it moves the status, and that read is what the agent waits for.
	// UNIT_BOUNDARY_DESCRIPTION: a running machine is watched by its long poll whether or not it is ready: a ready guest going quiet or being restarted by the runner moves the machine's status, and that read is what notices it, so the backstop of reconciling every running agent every minute is not needed to find out. A machine that should run but reports a failure is left off the watch and to the health poll, because the runner answers a failed attempt with a new status version, and a watch on it would reconcile the agent as fast as it fails; on its way up it is watched, since its guest can answer before the start call returns. A machine that should not run is watched until it stops.
	watched := st.Ready || st.Reason == "" || st.Reason == vmrunner.ReasonNotReady || st.Reason == vmrunner.ReasonCopyingDisk || st.Reason == vmrunner.ReasonOOMKilled || st.Reason == vmrunner.ReasonSeccompKilled
	if running && watched || !running && !machineStopped(st) {
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

// UNIT_BOUNDARY_DESCRIPTION: a vm agent has no pod, so its Service selects the owner's runner and maps the agent port onto the one that machine publishes there — which needs a ClusterIP, since a headless Service hands back the pod address without remapping the port. Selecting works only because the runner shares this namespace; a selector never reaches across one. It is applied rather than created once, because the published port moves when a machine is recreated, and a headless one, the container's, is replaced, since a cluster address cannot be given to a Service in place.
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
	if err == nil && existing.Spec.ClusterIP == corev1.ClusterIPNone {
		if err = cli.Delete(ctx, name, metav1.DeleteOptions{}); err == nil || k8serrors.IsNotFound(err) {
			err = k8serrors.NewNotFound(corev1.Resource("services"), name)
		}
	}
	if k8serrors.IsNotFound(err) {
		_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	if err != nil {
		return err
	}
	if maps.Equal(existing.Spec.Selector, desired.Spec.Selector) && len(desired.Spec.Ports) == len(existing.Spec.Ports) && equality.Semantic.DeepDerivative(desired.Spec.Ports, existing.Spec.Ports) {
		return nil
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

// UNIT_BOUNDARY_DESCRIPTION: how long a runner that cannot be reached, and whose owner has no Agent of any kind, is kept before the sweep removes it anyway. Only an agent's reconcile creates a runner, so such a runner serves nobody; the grace covers a runner that is merely restarting while its owner's Agents are being recreated. A machine that no Agent claims waits the same grace before the sweep collects it, since a List that reads empty comes and goes, and an Agent's workspace has no backup.
const orphanGrace = 30 * time.Minute

func (r *AgentReconciler) ReconcileOrphanMachines(ctx context.Context) {
	if err := r.assertStoreAbsorbed(ctx); err != nil {
		slog.Warn("orphan machine GC: skipped, the Agent store is not the absorbed one", "error", err)
		return
	}
	if r.config.VM.Runner.HostAddress != "" {
		r.dropPodRunners(ctx)
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

// UNIT_BOUNDARY_DESCRIPTION: the whole pass over one runner holds the owner's lock, which an agent's reconcile also holds while it builds the runner and ensures its machine. What the sweep reads — the owner's Agents in a fresh List and in the informer cache, and the runner's own machine list — therefore cannot change under it through this controller, and a runner is removed only when all of them still say it serves nobody. A machine is collected when no Agent of this owner has its name and no sweep has seen one with it for the grace: an Agent of the same name that belongs to someone else says nothing about this runner.
func (r *AgentReconciler) sweepRunner(ctx context.Context, runner runnerRef) {
	owner := runner.owner
	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()

	agents, err := r.backend.List(ctx, labels.SelectorFromSet(labels.Set{envoyOwnerLabel: owner}))
	if err != nil {
		slog.Warn("orphan machine GC: listing the owner's agents failed", "owner", owner, "error", err)
		return
	}
	var ids []string
	if runner.client != nil {
		ids, err = runner.client.List(ctx)
	}
	if runner.client == nil || err != nil {
		r.collectUnreachableRunner(ctx, owner, len(agents), err)
		return
	}
	r.ownerless.Delete(owner)
	r.sweepMachines(ctx, owner, ids, agents, runner.client.Delete)
	if len(agents) > 0 || r.cachedOwnerAgents(ctx, owner) > 0 {
		return
	}
	r.deleteOwnerGateway(ctx, owner)
	left, err := runner.client.List(ctx)
	if err != nil || len(left) > 0 {
		slog.Info("orphan machine GC: runner kept, it is not empty", "owner", owner, "machines", len(left), "error", err)
		return
	}
	r.deleteRunner(ctx, owner, false)
}

// UNIT_BOUNDARY_DESCRIPTION: an install switched from runner pods to the host runner keeps the per-owner runner Deployments it made before, and nothing else looks at them in host mode, so their pods stay Pending for want of a KVM device. Only the Deployment goes: its claim holds the disks of the machines it ran, the one copy of those homes, and switching back to runner pods remakes the Deployment on that same claim. A runner is recognized by its owner label and the per-owner name, never by the label alone, and is deleted only as it was listed.
func (r *AgentReconciler) dropPodRunners(ctx context.Context) {
	deps := r.client.AppsV1().Deployments(r.config.Namespace)
	list, err := deps.List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + vmRunnerComponent})
	if err != nil {
		slog.Warn("vm runner: listing runner pods left from before the host runner failed", "error", err)
		return
	}
	for i := range list.Items {
		dep := &list.Items[i]
		owner := dep.Labels[envoyOwnerLabel]
		if owner == "" || dep.Name != fmt.Sprintf("%s-vm-runner-%s", r.config.ReleaseName, runnerSuffix(owner)) {
			continue
		}
		uid, rv := dep.UID, dep.ResourceVersion
		if err := deps.Delete(ctx, dep.Name, metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &uid, ResourceVersion: &rv}}); err != nil && !k8serrors.IsNotFound(err) {
			slog.Warn("vm runner: removing a runner pod left from before the host runner failed", "owner", owner, "error", err)
			continue
		}
		slog.Info("vm runner: removed a runner pod left from before the host runner; its claim, holding its machines' disks, is kept", "owner", owner, "claim", dep.Name)
	}
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
	agents, err := r.backend.List(ctx, labels.Everything())
	if err != nil {
		slog.Warn("orphan machine GC: listing agents failed", "error", err)
		return
	}
	r.sweepMachines(ctx, "", ids, agents, runner.Delete)
}

// UNIT_BOUNDARY_DESCRIPTION: an Agent's workspace has no backup, and a live List of the owner's Agents can read empty for a while on a cluster that shares its CRDs, so a machine one sweep finds unclaimed may be live. The informer cache is a second opinion beside that List, and time is the third: a machine is deleted only when both name no Agent for it and no sweep has found one for the grace. The first sweep that finds it unclaimed records when, and a sweep that finds it claimed forgets that, so a machine claimed again waits the whole grace. Anything an Agent names as a machine an aborted migration left keeps its mark until the machine is gone. With no owner, the machines are those of the host runner, which serves every owner.
func (r *AgentReconciler) sweepMachines(ctx context.Context, owner string, ids []string, agents []unstructured.Unstructured, deleteMachine func(context.Context, string) error) {
	claimed := machineClaims(agents)
	cached := r.cachedMachineClaims(owner)
	if cached == nil {
		slog.Warn("orphan machine GC: the agent cache cannot be read, no machine is collected this pass", "owner", owner)
		return
	}
	maps.Copy(claimed, cached)
	live := make(map[string]bool, len(ids))
	for _, id := range ids {
		live[id] = true
		key := owner + "/" + id
		if claimed[id] {
			r.orphanMachines.Delete(key)
			continue
		}
		first, seen := r.orphanMachines.LoadOrStore(key, time.Now())
		if !seen || time.Since(first.(time.Time)) < orphanGrace {
			continue
		}
		if err := deleteMachine(ctx, id); err != nil {
			slog.Warn("orphan machine GC: delete failed", "machine", id, "owner", owner, "error", err)
			continue
		}
		r.orphanMachines.Delete(key)
		slog.Info("orphan machine GC: deleted machine for missing agent", "machine", id, "owner", owner)
	}
	r.orphanMachines.Range(func(k, _ any) bool {
		key, _ := k.(string)
		if id, ok := strings.CutPrefix(key, owner+"/"); ok && !live[id] {
			r.orphanMachines.Delete(key)
		}
		return true
	})
}

// UNIT_BOUNDARY_DESCRIPTION: which machines the informer cache's Agents say are theirs, read as the second opinion beside a sweep's live List: on a cluster that shares its CRDs the List can read empty for a while, and a machine deleted on it alone costs the owner every disk of their runner. A cache that cannot be read answers nothing at all, which keeps every machine, as the cache does for the runner. With no owner, every Agent in the namespace claims, since the host runner serves them all.
func (r *AgentReconciler) cachedMachineClaims(owner string) map[string]bool {
	claimed := map[string]bool{}
	if r.agentCache == nil {
		return claimed
	}
	selector := labels.Everything()
	if owner != "" {
		selector = labels.SelectorFromSet(labels.Set{envoyOwnerLabel: owner})
	}
	items, err := r.agentCache.ByNamespace(r.config.Namespace).List(selector)
	if err != nil {
		return nil
	}
	for _, obj := range items {
		if u, ok := obj.(*unstructured.Unstructured); ok {
			maps.Copy(claimed, machineClaims([]unstructured.Unstructured{*u}))
		}
	}
	return claimed
}

// UNIT_BOUNDARY_DESCRIPTION: which machines the listed Agents claim. An Agent's workspace has no backup, so a machine is kept unless every reading of the Agents, live and cached, fails to name one.
func machineClaims(agents []unstructured.Unstructured) map[string]bool {
	claimed := map[string]bool{}
	for i := range agents {
		claimed[agents[i].GetName()] = true
	}
	return claimed
}

// UNIT_BOUNDARY_DESCRIPTION: a runner the sweep cannot ask what it holds is kept while its owner has any Agent at all. One whose owner has none is kept for the grace, then removed without its claim: nobody could see what the claim holds, and an empty List of Agents can be a CRD event rather than an owner who left, so the claim stays for the owner's next vm Agent to build its runner on.
func (r *AgentReconciler) collectUnreachableRunner(ctx context.Context, owner string, listed int, cause error) {
	if listed > 0 || r.cachedOwnerAgents(ctx, owner) > 0 {
		r.ownerless.Delete(owner)
		slog.Warn("orphan machine GC: the owner's VM runner cannot be reached, it is kept", "owner", owner, "error", cause)
		return
	}
	first, _ := r.ownerless.LoadOrStore(owner, time.Now())
	since := time.Since(first.(time.Time))
	if since < orphanGrace {
		slog.Warn("orphan machine GC: a VM runner that cannot be reached serves no agent; it is removed if that lasts", "owner", owner, "for", since.Round(time.Second), "grace", orphanGrace, "error", cause)
		return
	}
	slog.Warn("orphan machine GC: removing a VM runner that cannot be reached and whose owner has no agents; its claim is kept, with every disk on it", "owner", owner, "claim", r.runnerName(owner), "for", since.Round(time.Second), "error", cause)
	r.deleteRunner(ctx, owner, true)
}

// UNIT_BOUNDARY_DESCRIPTION: the owner's Agents as the informer sees them, counted as a second opinion beside a fresh List: either one knowing of an Agent keeps the runner.
func (r *AgentReconciler) cachedOwnerAgents(ctx context.Context, owner string) int {
	items, err := r.ownerAgents(ctx, owner)
	if err != nil {
		return 1
	}
	return len(items)
}

// UNIT_BOUNDARY_DESCRIPTION: an agent's machine lives on its owner's runner, so a delete that knows the owner goes to that runner alone, and an owner with no runner has no machine to delete. The runner's Deployment is read first, so an owner who never had a runner is not reported as an unreachable one. A delete with no owner, from an Agent whose labels the informer never saw, is offered to every runner, each of which ignores a machine it does not have. Anything a targeted delete misses, such as a machine left on a runner the Agent's owner label no longer names, is collected by the orphan sweep.
func (r *AgentReconciler) deleteMachine(ctx context.Context, name, owner string) error {
	r.unwatchMachine(name)
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
func (r *AgentReconciler) OwnerAgents(owner string) []unstructured.Unstructured {
	if r.agentCache == nil || owner == "" {
		return nil
	}
	items, err := r.agentCache.ByNamespace(r.config.Namespace).List(labels.SelectorFromSet(labels.Set{envoyOwnerLabel: owner}))
	if err != nil {
		return nil
	}
	var agents []unstructured.Unstructured
	for _, obj := range items {
		if u, ok := obj.(*unstructured.Unstructured); ok {
			agents = append(agents, *u)
		}
	}
	return agents
}

func (r *AgentReconciler) OwnerVMAgents(owner string) []string {
	agents := r.OwnerAgents(owner)
	names := make([]string, 0, len(agents))
	for _, u := range agents {
		names = append(names, u.GetName())
	}
	return names
}

func (r *AgentReconciler) HaltMachine(ctx context.Context, owner, name string) error {
	r.unwatchMachine(name)
	if owner == "" {
		return nil
	}
	agent, err := r.backend.Get(ctx, name)
	if err != nil {
		if k8serrors.IsNotFound(err) {
			return nil
		}
		return err
	}
	if r.config.VM.Runner.HostAddress == "" {
		if _, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, r.runnerName(owner), metav1.GetOptions{}); k8serrors.IsNotFound(err) {
			return nil
		} else if err != nil {
			return fmt.Errorf("reading the owner's VM runner: %w", err)
		}
	}
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return err
	}
	halt := vmrunner.MachineSpec{Running: false}
	st, err := client.Ensure(ctx, name, halt)
	r.stallRunnerHandoffOnEnsure(ctx, owner, err)
	if err != nil {
		return fmt.Errorf("stopping machine for %s: %w", name, err)
	}
	if !machineStopped(st) {
		r.watchMachine(client, name, st.Version)
		return fmt.Errorf("%w: it is %s", errMachineStopping, st.State)
	}
	// UNIT_BOUNDARY_DESCRIPTION: the stop is stamped here, where the runner answers it, and not left to the next check: nothing reconciles the agent in between, so a kill of the runner landing in that window would name an agent whose machine had already stopped.
	if agent.GetAnnotations()[annMachineDown] == "" {
		down := time.Now().UTC().Format(time.RFC3339Nano)
		if err := r.patchAgent(ctx, name, map[string]*string{annMachineDown: &down}); err != nil {
			slog.Warn("stamping the end of a machine's episode", "agent", name, "error", err)
		}
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the ceiling a machine the runner is already bringing up is re-sent with, while the node reports no grant. It authorizes no footprint at all — admission needs strictly more than this — so a runner that finds the machine stopped refuses the start instead of booting it, while an operation already admitted is let through by the same runner, and a runner from before that exemption keeps such an operation because this controller no longer parks a boot in flight. Zero would be the whole pool in exactly that stopped case, so the figure is one MiB: the tightest ceiling the wire can carry, and one no boot of a machine that holds memory can be confused with.
func (r *AgentReconciler) holdInFlight(owner, name string) int {
	r.holdHeld.Store(name, true)
	return grantHeldMiB
}

// UNIT_BOUNDARY_DESCRIPTION: what a start held on an unreadable grant reads as once the wait outlasts grantUnreadableBound: the problem named, and the cadence it is retried at, since nothing the owner does frees memory the node has not reported.
const vmAllocationUnreadableMessage = "The node has not reported how much memory it granted this owner's VM runner, so this start can't be admitted yet. The platform keeps retrying every 30 seconds; if this lasts, an admin should check that the cluster can resize pods in place."

// UNIT_BOUNDARY_DESCRIPTION: whether the state a runner reports is one that holds memory. A machine booting, running, restarting or stopping does; a start, and a machine that stopped or that the runner has no record of, does not.
func holdsMemory(state string) bool {
	switch state {
	case vmrunner.StateCreating, vmrunner.StateStarting, vmrunner.StateRestarting, vmrunner.StateRunning, vmrunner.StateStopping:
		return true
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: a start the runner's own limit has room for and the node has granted nothing it can be admitted against waits for the node to report. That wait is short when the node is merely late, so the Agent is retried at the machine watch's cadence under the reason a waiting start carries, and the resize the start needs is asked for in this same reconcile, even when it asks for nothing new, so a node that cannot report is told apart from one that has not answered yet. A wait that outlasts the bound ends in a state that names the problem and is retried at the parked tick: the promise of an automatic start has to have a way out, while the start keeps holding.
func (r *AgentReconciler) holdUnreadableGrant(ctx context.Context, owner, name string, demand runnerDemand, state string) vmrunner.MachineStatus {
	since, held := r.grantHolds.Load(name)
	if !held {
		since = time.Now()
		r.grantHolds.Store(name, since)
	}
	if r.config.VM.Runner.HostAddress == "" {
		r.probeRunnerResize(ctx, owner, demand)
	}
	if time.Since(since.(time.Time)) >= grantUnreadableBound {
		return vmrunner.MachineStatus{State: state, Reason: apiv1.ReasonAllocationUnreadable, Message: vmAllocationUnreadableMessage}
	}
	return vmrunner.MachineStatus{State: state, Reason: vmrunner.ReasonAwaitingAllocation, Message: vmAwaitingAllocationMessage}
}

func machineStopped(st vmrunner.MachineStatus) bool {
	return st.State == vmrunner.StateStopped || st.State == vmrunner.StateAbsent
}

func (r *AgentReconciler) publishVMReadiness(ctx context.Context, agent *apiv1.Agent, st vmrunner.MachineStatus, runnerReached bool) error {
	msg := st.Message
	if !st.Ready && msg == "" {
		msg = "machine is " + st.State
	}
	if r.requeue != nil {
		if runnerReached {
			r.notReadyPolls.Delete(agent.Name)
		}
		// UNIT_BOUNDARY_DESCRIPTION: a ready machine is not requeued: its watch on the runner requeues the Agent the moment the machine's status moves, so nothing would come of reconciling a settled agent minute after minute. Everything short of ready is looked at again, on the readiness poll while the runner is out of reach and on the health poll otherwise, which is what notices a start that never completes and a machine that fails as fast as the runner retries it.
		if !st.Ready {
			poll := vmHealthPoll
			if !runnerReached {
				poll = r.nextNotReadyPoll(agent.Name)
			}
			r.requeue(agent.Name, poll)
		}
	}
	reason := st.Reason
	switch reason {
	case "":
		reason = vmrunner.ReasonNotReady
	case vmrunner.ReasonHomeFull:
		reason = apiv1.ReasonHomeVolumeFull
	case vmrunner.ReasonImageCacheUnreachable:
		// UNIT_BOUNDARY_DESCRIPTION: the runner sees its own mount of the cache directory, and two runners on one node directory and on a stale copy of it refuse with the same socket, so the Agent's own failure names the node directory this runner mounts. That is the fact an operator compares with the one the cache service writes, and it is here because a start that fails without a pending runner change writes no roll Event to carry it.
		if src := r.runnerImageCacheSourceOf(ctx, agent.Labels[envoyOwnerLabel]); src != "" {
			msg += " (this runner mounts the node's " + src + " as its image cache)"
		}
	}
	kill, record, named := r.runnerOOMAttribution(ctx, agent, time.Now())
	// UNIT_BOUNDARY_DESCRIPTION: a machine that answered ready, or that took a reason of its own, has done with the kill: the reason it wears now is its own account of itself, and the kill does not come back over it. What the controller says about the runner itself — its node lost, its pod unschedulable — is no account of this machine, so it ends nothing.
	over := st.Ready || (runnerReached && runnerCausedThisMachine(st.Reason))
	if over {
		named = false
	}
	// UNIT_BOUNDARY_DESCRIPTION: the kill is published over the reason the restarted runner gives for a machine it has no account of its own for — a refusal for room, a wait for the node, a boot that has not answered — because every machine of the owner lived in the killed pod and the kill took all of them down together. A reason the runner gives for this machine alone outranks it, and so does a guest that has answered.
	if named {
		reason, msg = apiv1.ReasonRunnerOutOfMemory, runnerOOMNotice
	}
	restartReason := ""
	if st.Restarts > 0 {
		restartReason = "GuestStoppedAnswering"
	}
	var clock vmStartClock
	if v, ok := r.vmStartClocks.Load(agent.Name); ok {
		clock = v.(vmStartClock)
	}
	clock, failure := vmStartFailure(clock, agent.Generation, st, time.Now())
	if runnerReached {
		r.vmStartClocks.Store(agent.Name, clock)
	}
	if err := r.publishReadinessOf(ctx, agent, st.Ready, reason, msg, runnerReached, st.Restarts, restartReason,
		func(s *apiv1.AgentStatus) {
			nestingCondition(s, agent, st, r.config.AgentTemplateDefaults, r.config.VM.Runner.NestedVirtualization)
			r.runnerCapacityCondition(s, agent)
			if runnerReached {
				setStartFailure(s, failure, agent.Generation)
			}
			if named {
				setConditionTime(s, apiv1.ConditionAgentPodReady, kill.At)
			}
		}); err != nil {
		return err
	}
	// UNIT_BOUNDARY_DESCRIPTION: what this pass decided about the kill is recorded after the status that carries it, so a status write that failed decides nothing and the retry still names the kill.
	return r.recordKill(ctx, agent, kill, record, named, over)
}

// UNIT_BOUNDARY_DESCRIPTION: the sentence the owner reads when the kill is what took this agent's machine down. It is one string so that every path that takes a vm agent down tells the same story: the notice, the Slack alert and the history all read the reason on AgentPodReady.
const runnerOOMNotice = "Your VM agents ran out of memory together, so the ones that were running restarted. Disable agents you aren't using to free memory."

// UNIT_BOUNDARY_DESCRIPTION: the marks an agent carries about the kills of its owner's runner and the machine it ran on, all persisted so that a kill is decided once: the kill it was attributed, which is the record that it was decided; the kill that is over for it, so a later pass never names it again; when its machine last began holding memory; and when it was last seen stopped. An absent stop is a machine that may still be holding memory, and an absent start one whose start went before the platform wrote these marks, so a kill goes to an agent whose stamps do not put its machine away from the runner at the kill.
const (
	annRunnerOOMKill = "agent-platform.ai/runner-oom-kill"
	annRunnerOOMDone = "agent-platform.ai/runner-oom-over"
	annMachineUp     = "agent-platform.ai/machine-up-at"
	annMachineDown   = "agent-platform.ai/machine-down-at"
)

// UNIT_BOUNDARY_DESCRIPTION: the kill this agent carries, from the annotation that records it. A kill named there was attributed once, so a reconcile, a controller restart and a runner pod whose termination history has moved on all read the same answer, and the agent is never told about that kill twice.
func carriedKill(agent *apiv1.Agent) runnerKill {
	id := agent.Annotations[annRunnerOOMKill]
	i := strings.LastIndex(id, "@")
	if i < 0 {
		return runnerKill{}
	}
	finished, err := time.Parse(time.RFC3339, id[i+1:])
	if err != nil {
		return runnerKill{}
	}
	return runnerKill{ID: id, At: finished}
}

// UNIT_BOUNDARY_DESCRIPTION: whether this agent's machine was holding memory on the killed runner at the kill, from the two stamps the controller writes as it watches the machine. A machine started after the kill is no victim, and neither is one seen stopped before it; one booting, running or stopping at the kill is, and so is one a reclaim put to sleep after it, since its start went before the kill and its end did not. A machine the stamps say nothing about — its start lies before the platform wrote them at all — counts as one that was there unless the agent itself was created after the kill or its machine was seen stopped before it, since the record is incomplete rather than the machine absent.
func machineOccupiedAt(agent *apiv1.Agent, at time.Time) bool {
	// UNIT_BOUNDARY_DESCRIPTION: the kill's time is the kernel's, at the second, and the stamps are the controller's, and a stamp is written only while a runner answers: inside the kill's own second the only runner that answers is the one the kill took down, so a stamp in that second reads as an event from before the kill. A start there is a machine the kill found, and a stop there one that had already stopped, and only a later second can put a machine away from the kill. An agent's creation time is no runner's answer, so one created in that second had no machine on the runner: had it booted before the kill, the boot would have stamped it.
	at = at.Truncate(time.Second)
	if up, err := time.Parse(time.RFC3339Nano, agent.Annotations[annMachineUp]); err == nil {
		if up.Truncate(time.Second).After(at) {
			return false
		}
	} else if !agent.CreationTimestamp.IsZero() && !agent.CreationTimestamp.Time.Truncate(time.Second).Before(at) {
		return false
	}
	down, err := time.Parse(time.RFC3339Nano, agent.Annotations[annMachineDown])
	return err != nil || down.Truncate(time.Second).After(at)
}

// UNIT_BOUNDARY_DESCRIPTION: whether the kill is over for this agent: its machine answered ready after it, which is the kill whose name the answer stamped, or the ten minutes the kill explains have passed. Both are durable, so the reason never comes back to that agent after it recovers, however long the runner keeps the termination in its history and whatever its machine does next. The answer names the kill rather than the time it was given, so a controller whose clock sits a few seconds from the node's reads the same recovery the node does.
func killIsOver(agent *apiv1.Agent, kill runnerKill, now time.Time) bool {
	if now.Sub(kill.At) > runnerOOMEpisode {
		return true
	}
	return agent.Annotations[annRunnerOOMDone] == kill.ID
}

// UNIT_BOUNDARY_DESCRIPTION: what this agent reads about the owner's latest kill: the kill it carries, whether the newest kill is one to record, and whether that kill is what the agent should read as down for. A kill the agent already carries is never decided again, which holds one kill to one notice however often it reconciles; a new kill is recorded whatever comes of it, so a kill the agent was not on, one it had already recovered from and one past its episode are decided where they are first read instead of surfacing later as new; and it is published only to a machine that was holding memory on the killed runner at its finished time and only while the ten minutes it explains are running. The runner's record of its kills moves forward, so a kill older than the one an agent carries never replaces it.
func (r *AgentReconciler) runnerOOMAttribution(ctx context.Context, agent *apiv1.Agent, now time.Time) (kill runnerKill, record, publish bool) {
	carried := carriedKill(agent)
	latest := r.runnerOOMKill(ctx, agent.Labels[envoyOwnerLabel])
	if !latest.IsZero() && carried.ID != latest.ID && (carried.IsZero() || latest.At.After(carried.At)) {
		// UNIT_BOUNDARY_DESCRIPTION: a kill this machine was not on is decided where it is read only once the kill the agent wears is over, so a second kill of the runner that took nothing from a machine asleep since the first does not silence the first one's notice. Waiting loses nothing: a start and a stop only move forward, so a machine the stamps put away from the runner at a kill is not on it at that kill when read later either.
		if named := machineOccupiedAt(agent, latest.At) && !killIsOver(agent, latest, now); named || killIsOver(agent, carried, now) {
			return latest, true, named
		}
	}
	if carried.IsZero() || killIsOver(agent, carried, now) {
		return carried, false, false
	}
	return carried, false, true
}

// UNIT_BOUNDARY_DESCRIPTION: the kill's reason, written on AgentPodReady over the reason the agent wears on Ready, in one status update: a refusal, a wait for the node and a hibernation each read as their own reason on Ready, which is what the budget surfaces, the parked retry and the hibernation read, and the notice, the Slack alert and the history read AgentPodReady, so that is where the kill goes. The record of the attribution is written beside it, so the agent never reads this kill as a new one again, and the agent is looked at when the episode ends: a machine nothing else reconciles, because it is asleep, would otherwise keep the reason for ever.
func (r *AgentReconciler) publishKill(ctx context.Context, agent *apiv1.Agent, own func(*apiv1.AgentStatus)) (bool, error) {
	kill, record, publish := r.runnerOOMAttribution(ctx, agent, time.Now())
	if err := r.updateStatus(ctx, agent.Name, func(s *apiv1.AgentStatus) {
		own(s)
		if publish {
			setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", apiv1.ReasonRunnerOutOfMemory, runnerOOMNotice, agent.Generation)
			setConditionTime(s, apiv1.ConditionAgentPodReady, kill.At)
		}
	}); err != nil {
		return publish, fmt.Errorf("publishing the kill that took this machine down: %w", err)
	}
	if err := r.recordKill(ctx, agent, kill, record, publish, false); err != nil {
		return publish, err
	}
	return publish, nil
}

// UNIT_BOUNDARY_DESCRIPTION: writes what this pass decided about the kill, after the status that carries it, and asks to be looked at when the kill's episode ends. Two marks go in one write: the kill the agent was attributed, so it is decided once, and the kill that is over for it — one it was not on, one whose episode had passed before it was read, or one its machine has answered ready or died of its own reason since — so no later pass reads that kill as one to name. Both go second so a status write that fails leaves nothing behind: the retry publishes the same reason and time, which is no change and no second notice, and it still knows what the agent recovered from. The requeue is what ends the reason on a machine nothing else reconciles, since an asleep machine has no machine watch to move it. Scheduling is not a status write, so a repeat reconcile still writes nothing.
func (r *AgentReconciler) recordKill(ctx context.Context, agent *apiv1.Agent, kill runnerKill, record, publish, over bool) error {
	patch := map[string]*string{}
	if record {
		patch[annRunnerOOMKill] = new(kill.ID)
	}
	if !kill.IsZero() && (over || (record && !publish)) && agent.Annotations[annRunnerOOMDone] != kill.ID {
		patch[annRunnerOOMDone] = new(kill.ID)
	}
	if len(patch) > 0 {
		if err := r.patchAgent(ctx, agent.Name, patch); err != nil {
			return fmt.Errorf("recording what this pass decided about the kill that took this machine down: %w", err)
		}
	}
	if publish && r.requeue != nil {
		if wait := time.Until(kill.At.Add(runnerOOMEpisode)); wait > 0 {
			r.requeue(agent.Name, wait)
		}
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the stamps that say when this agent's machine began holding memory and when it was last seen stopped, written as the controller watches it, which is what lets a kill of the runner be held to the machines that were on it. A machine beginning to hold memory starts an episode, and so does one woken after a sleep, since the machine the runner holds now is not the one the earlier start was written for; one seen stopped ends the episode it is in, which is kept until the next one starts, so a kill that lands while the machine sleeps still reads the start that went before it. A runner that could not be reached says nothing about the machine, so nothing is stamped.
func (r *AgentReconciler) stampMachine(ctx context.Context, agent *apiv1.Agent, machine vmrunner.MachineStatus, runnerReached bool) (*apiv1.Agent, error) {
	if !runnerReached {
		return agent, nil
	}
	up, down := agent.Annotations[annMachineUp], agent.Annotations[annMachineDown]
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var patch map[string]*string
	switch {
	case holdsMemory(machine.State) && up != "" && down == "":
		return agent, nil
	case holdsMemory(machine.State):
		patch = map[string]*string{annMachineUp: &now, annMachineDown: nil}
	case machineStopped(machine) && down == "":
		patch = map[string]*string{annMachineDown: &now}
	default:
		return agent, nil
	}
	if err := r.patchAgent(ctx, agent.Name, patch); err != nil {
		return agent, err
	}
	// UNIT_BOUNDARY_DESCRIPTION: the caller gets a copy carrying the stamps just written, so the attribution later in this same pass reads the machine as it is now and not as it was before it, and the shared object the informer handed this pass is never written.
	stamped := agent.DeepCopy()
	if stamped.Annotations == nil {
		stamped.Annotations = map[string]string{}
	}
	for k, v := range patch {
		if v == nil {
			delete(stamped.Annotations, k)
			continue
		}
		stamped.Annotations[k] = *v
	}
	return stamped, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a reason the runner gives for this machine alone — its boot, its image, its disk, the kernel's kill of its VMM — is a finer answer than the pod-level kill, and outranks it: the pod's kill says the whole runner died at once, which is no account of what this machine did afterwards. Room and readiness say nothing about a cause, so the kill explains those, and a refusal for room or a machine a reclaim put to sleep is exactly what the kill leaves behind.
func runnerCausedThisMachine(reason string) bool {
	switch reason {
	case "", vmrunner.ReasonNotReady, vmrunner.ReasonOutOfCapacity, vmrunner.ReasonAwaitingAllocation:
		return false
	}
	return true
}

// UNIT_BOUNDARY_DESCRIPTION: the time a condition reads, which `apimeta.SetStatusCondition` leaves where it was whenever the status does not change, so a published cause keeps the flip of a state that came before it. The kill's own time is what the episode is judged by, so it is written over it.
func setConditionTime(s *apiv1.AgentStatus, condType string, at time.Time) {
	if c := apimeta.FindStatusCondition(s.Conditions, condType); c != nil {
		c.LastTransitionTime = metav1.NewTime(at)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: how long after an OOM kill of an owner's runner the kill is still what its agents' machines read as down: a boot after one takes seconds, but a restarted runner refuses room to some machines and a reclaim puts others to sleep, and those consequences of the kill land minutes later, on a remade runner pod that still carries the kill in its last termination. Past it the kill explains nothing the agent reads now, so the agent falls back to its own reason, which a boot that keeps failing needs in order to be seen as the failure it is.
const runnerOOMEpisode = 10 * time.Minute

func wantsNesting(agent *apiv1.Agent, defaults config.AgentTemplateDefaults) bool {
	return defaults.NestedVirtualization || agent.Spec.NestedVirtualization
}

// UNIT_BOUNDARY_DESCRIPTION: tells an owner whose agent asks for nesting, itself or through controller.agent.templateDefaults.nestedVirtualization, whether the agent's machine got it, since the runner boots it without nesting rather than refusing it: the install may not let its runners nest, and a node whose KVM does not allow it grants nothing. An Agent that does not ask carries no condition, and one that stops asking loses it.
func nestingCondition(s *apiv1.AgentStatus, agent *apiv1.Agent, st vmrunner.MachineStatus, defaults config.AgentTemplateDefaults, installAllows bool) {
	if !wantsNesting(agent, defaults) {
		apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionNestedVirtualization)
		return
	}
	reason, msg := "NodeCannotNest", "the machine boots without nesting: the node's KVM does not allow it (kvm_intel or kvm_amd nested=0)"
	switch {
	case !installAllows:
		reason, msg = "NotAllowedByInstall", "this install does not let machines nest: virtualization.runner.nestedVirtualization is off"
	case st.Nested:
		msg = ""
	case st.State == "" || st.State == vmrunner.StateAbsent:
		reason, msg = "MachinePending", "the machine has not been created yet"
	}
	setStatusCondition(s, apiv1.ConditionNestedVirtualization, st.Nested, "Enabled", reason, msg, agent.Generation)
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
	if err := r.updateStatus(ctx, agent.Name, func(s *apiv1.AgentStatus) {
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
	if err := r.updateStatus(ctx, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", vmrunner.ReasonNotReady, msg, gen)
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", "PodsNotReady", "", gen)
	}); err != nil {
		slog.Warn("writing agent machine-error status", "agent", agent.Name, "error", err)
	}
	return r.setError(ctx, agent.Name, msg)
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent has no disk size of its own: every disk is sparse and may grow to the owner's whole storage pool, so the claim's use is the owner's real use, which the runner's storage guard watches. A machine the runner does not hold yet is created at the pool, since every runner release creates a disk at the size it is asked for. An existing machine whose runner reports no disk size may be on an older release, which would restart a running machine to grow its disk, so it keeps the size the Agent's spec gives it: a new pool reboots no agent. So does a machine whose pool cannot be read, which the claim reports. The answer is remembered, and an ensure that reports a disk size marks the runner as one that grows disks, so the status is read once per machine.
func (r *AgentReconciler) machineDiskGiB(ctx context.Context, runner *vmrunner.Client, owner, name string, legacyGiB int) int {
	grows, known := r.vmDiskGrows.Load(name)
	if !known {
		st, err := runner.Status(ctx, name)
		if err != nil {
			return legacyGiB
		}
		grows = st.State == vmrunner.StateAbsent || st.DiskGiB > 0
		r.vmDiskGrows.Store(name, grows)
	}
	if grows != true {
		return legacyGiB
	}
	pool, err := r.runnerStorageCeiling(ctx, owner)
	if err != nil {
		return legacyGiB
	}
	return max(int(pool.Value()>>30), 1)
}

// UNIT_BOUNDARY_DESCRIPTION: a machine's storage is one disk holding one path, and that is the whole model. On a runner that grows a disk at the next start, the size worked out here only names the disk an older runner keeps (machineDiskGiB); the path rule holds on every runner. The size is one quantity, rounded once, and the path is not configurable: HOME is fixed, every template in the chart persists it and nothing else, and a machine's root lasts only until an image of another root generation boots. A mount that asks for anything else outside HOME is refused rather than dropped, because an agent whose work is silently discarded looks healthy until it stops. A size a persisted mount declares raises the disk rather than being dropped, since a spec that asks for 50Gi must not quietly get the chart's 10Gi. Several of them take the largest and not the sum, because they are all nested inside the one path a machine keeps and a sum would size the disk for capacity no single mount could have claimed.
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

// UNIT_BOUNDARY_DESCRIPTION: what a machine trusts, as the one ca.crt its share carries: the gateway's MITM CA, then the extra CAs the install names. The entrypoint trusts every certificate in it, and the runtime wrapper hands all of them to the containers the machine runs.
func machineTrustedCAs(gatewayCA string, cfg *config.Config) string {
	if cfg.ExtraTrustedCAs == "" {
		return gatewayCA
	}
	return strings.TrimRight(gatewayCA, "\n") + "\n" + cfg.ExtraTrustedCAs
}
