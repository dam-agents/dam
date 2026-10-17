package reconciler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	stderrors "errors"
	"github.com/go-logr/logr"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"

	"k8s.io/apimachinery/pkg/api/equality"
	"k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/retry"
	"log/slog"
	"net/http"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

type AgentReconciler struct {
	client  kubernetes.Interface
	dynamic dynamic.Interface
	config  *config.Config

	budgetMu              sync.Mutex
	ownerLocks            map[string]*sync.Mutex
	deniedWakes           map[string]string
	parkedRetry           map[string]struct{}
	busyProbe             func(ctx context.Context, agentName string) bool
	podStatus             func(ctx context.Context, agentName string) (idle, answered bool)
	runnerMu              sync.Mutex
	runners               map[string]runnerConn
	runnerEndpoint        func(owner string) string
	runnerRollMu          sync.Mutex
	runnerRoll            runnerRollView
	rollViewTTL           time.Duration
	requeue               func(name string, after time.Duration)
	lifetime              context.Context
	podResize             atomic.Int32
	agentCache            cache.GenericLister
	podCache              corelisters.PodLister
	statefulSets          cache.MutationCache
	runnerDeploys         cache.MutationCache
	runnerPodCache        corelisters.PodLister
	vmRunning             sync.Map
	vmLive                sync.Map
	vmDiskGrows           sync.Map
	vmPools               sync.Map
	usageSecrets          sync.Map
	resizeNotices         sync.Map
	runnerCapacity        sync.Map
	poolLevels            sync.Map
	notReadyPolls         sync.Map
	vmStartClocks         sync.Map
	ownerless             sync.Map
	machineWatchMu        sync.Mutex
	machineWatches        map[string]*machineWatch
	pressureWatches       map[string]*machineWatch
	memoryPassMu          sync.Mutex
	memoryPassing         map[string]bool
	pressureFreed         map[string]time.Time
	preflightMu           sync.Mutex
	preflight             vmPreflightResult
	preflightDone         bool
	migrationCopyMu       sync.Mutex
	ownerGatewayRevisions sync.Map
	ownerProbeClient      *http.Client
}

func NewAgentReconciler(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *AgentReconciler {
	r := &AgentReconciler{client: client, dynamic: dyn, config: cfg, rollViewTTL: runnerRollViewTTL}
	r.busyProbe = func(ctx context.Context, name string) bool {
		idle, answered := agentPodStatus(ctx, r.config.Namespace, name)
		return answered && !idle
	}
	r.podStatus = func(ctx context.Context, name string) (bool, bool) {
		return agentPodStatus(ctx, r.config.Namespace, name)
	}
	return r
}

func (r *AgentReconciler) WithAgentCache(lister cache.GenericLister) *AgentReconciler {
	r.agentCache = lister
	return r
}

// UNIT_BOUNDARY_DESCRIPTION: a reconcile reads an agent's pods up to three times, and every change to those pods already requeues the agent through the pod informer, so the informer's cache answers instead of the API server. A reconciler built without the cache — the tests — reads them live.
func (r *AgentReconciler) WithPodCache(lister corelisters.PodLister) *AgentReconciler {
	r.podCache = lister
	return r
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent's reconcile read its gateway StatefulSet about four times and its owner's runner Deployment twice, each a live GET, so informer caches answer instead. The cache is wrapped so a reconcile reads its own writes: right after an update the informer can still hold the version before it, and a readiness check on that version would see a pod on the old template as current. A write sent from a stale read fails on its resourceVersion, and the write is then tried again from a live read. A reconciler built without the caches — the tests — reads live.
func (r *AgentReconciler) WithStatefulSetCache(informer cache.SharedIndexInformer) *AgentReconciler {
	r.statefulSets = readsOwnWrites(informer)
	return r
}

func (r *AgentReconciler) WithRunnerCaches(deployments cache.SharedIndexInformer, pods corelisters.PodLister) *AgentReconciler {
	r.runnerDeploys = readsOwnWrites(deployments)
	r.runnerPodCache = pods
	return r
}

// UNIT_BOUNDARY_DESCRIPTION: an object written here is served from the write's response until the informer holds a newer one. Adds are not served: an object the informer does not hold, because it was just created or just deleted, reads as missing, and the create that follows fails as already existing and is tried again live.
func readsOwnWrites(informer cache.SharedIndexInformer) cache.MutationCache {
	return cache.NewIntegerResourceVersionMutationCacheWithOptions(logr.FromSlogHandler(slog.Default().Handler()), informer.GetStore(),
		cache.MutationCacheOptions{TTL: time.Minute, MaxCacheSize: 1000})
}

func cachedGet[T runtime.Object](c cache.MutationCache, resource schema.GroupResource, namespace, name string, live func() (T, error)) (T, error) {
	var none T
	if c == nil {
		return live()
	}
	obj, ok, err := c.GetByKey(namespace + "/" + name)
	if err != nil {
		return none, err
	}
	if !ok {
		return none, errors.NewNotFound(resource, name)
	}
	return obj.(T).DeepCopyObject().(T), nil
}

func (r *AgentReconciler) statefulSet(ctx context.Context, name string, fromCache bool) (*appsv1.StatefulSet, error) {
	c := r.statefulSets
	if !fromCache {
		c = nil
	}
	return cachedGet(c, appsv1.Resource("statefulsets"), r.config.Namespace, name, func() (*appsv1.StatefulSet, error) {
		return r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	})
}

// UNIT_BOUNDARY_DESCRIPTION: how work the reconciler starts outside a reconcile — a machine watch — puts an Agent back on the queue, and the lifetime that work is bound to: the leader context, so it ends with the leadership that owns the queue. A requeue with no delay says the machine moved, which a person waiting on a wake needs now; a delayed one is a poll and can wait its turn.
func (r *AgentReconciler) WithRequeue(lifetime context.Context, fn func(name string, after time.Duration)) *AgentReconciler {
	r.lifetime = lifetime
	r.requeue = fn
	return r
}

func (r *AgentReconciler) Reconcile(ctx context.Context, agent *apiv1.Agent) (err error) {
	name := agent.Name
	var secretRefused string
	defer func() {
		if err == nil && secretRefused != "" {
			err = r.setError(ctx, name, secretRefused)
		}
	}()
	ownerRef := agentOwnerRef(agent)
	agentSpec := &agent.Spec

	timer := newReconcileTimer(ctx, "agent", name)
	defer timer.done()

	owner := agent.Labels["agent-platform.ai/owner"]

	if err := r.ensureConcreteSize(ctx, agent); err != nil {
		return fmt.Errorf("agent %s: %w", name, err)
	}

	credentialSecrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, name, owner,
		agentSpec.GrantedSecretIDs, agentSpec.GrantedConnectionIDs)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("listing credential secrets: %v", err))
	}
	timer.mark("credentials")

	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(name, agentSpec.TelemetryAttributionID, agentSpec.IsVM(), r.config, ownerRef, credentialSecrets, agentSpec.L7Hosts, agentSpec.RequireConnectionAddress)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("rendering envoy bootstrap: %v", err))
	}
	migration := runtimeMigrationOf(agent.Annotations, agent.Status)
	var liveGatewaySvc *corev1.Service
	moved, err := r.movedToOwnerGateway(ctx, agentSpec, name)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("reading gateway service: %v", err))
	}
	ownGateway := func(apply func() error) func() error {
		if moved {
			return func() error { return nil }
		}
		return apply
	}
	err = concurrently(
		ownGateway(func() error {
			if err := r.applyConfigMap(ctx, bootstrapCM); err != nil {
				return fmt.Errorf("applying envoy bootstrap: %v", err)
			}
			return nil
		}),
		ownGateway(func() error {
			cert := BuildEnvoyLeafCertificate(name, r.config, ownerRef, credentialSecrets, agentSpec.L7Hosts)
			if cert == nil {
				return nil
			}
			if err := r.applyCertificate(ctx, cert); err != nil {
				return fmt.Errorf("applying envoy leaf certificate: %v", err)
			}
			if err := r.ensureSecretOwnerReference(ctx, EnvoyLeafSecretName(name), nil, ownerRef); err != nil {
				slog.Warn("setting owner ref on envoy leaf TLS Secret; will retry on next reconcile",
					"agent", name, "error", err)
			}
			return nil
		}),
		ownGateway(func() error { return r.ensureServiceAccount(ctx, name, ownerRef) }),
		func() error {
			if err := r.applyExtAuthzService(ctx, BuildExtAuthzService(name, r.config)); err != nil {
				return fmt.Errorf("applying ext-authz service: %v", err)
			}
			return nil
		},
		func() error {
			policy := BuildHarnessAuthorizationPolicy(name, r.config, agent.Namespace, ownerRef)
			if r.ownerGatewayServes(agentSpec) || moved {
				admitOwnerGateway(policy, name, r.config.PrincipalFor(ownerGatewayName(r.config.ReleaseName, owner)), true)
			}
			if moved {
				dropOwnPrincipal(policy)
			}
			if err := r.applyUnstructured(ctx, authzPolicyGVR, policy); err != nil {
				return fmt.Errorf("applying harness authz policy: %v", err)
			}
			return nil
		},
		func() error {
			policy := BuildExtAuthzAuthorizationPolicy(name, r.config, agent.Namespace, ownerRef)
			if r.ownerGatewayServes(agentSpec) || moved {
				admitOwnerGateway(policy, name, r.config.PrincipalFor(ownerGatewayName(r.config.ReleaseName, owner)), false)
			}
			if moved {
				dropOwnPrincipal(policy)
			}
			if err := r.applyUnstructured(ctx, authzPolicyGVR, policy); err != nil {
				return fmt.Errorf("applying ext-authz authz policy: %v", err)
			}
			return nil
		},
		func() error {
			return applyNetworkPolicy(ctx, r.client, BuildAgentEgressNetworkPolicy(name, r.config, ownerRef))
		},
		ownGateway(func() error {
			return applyNetworkPolicy(ctx, r.client, BuildGatewayIngressNetworkPolicy(name, owner, agentSpec.IsVM() || migration.vmSideRuns(), r.config, ownerRef))
		}),
		ownGateway(func() error {
			return applyNetworkPolicy(ctx, r.client, BuildGatewayEgressNetworkPolicy(name, r.config, ownerRef))
		}),
		func() (err error) {
			desired := BuildGatewayService(name, agentSpec.IsVM(), r.config, ownerRef)
			if agentSpec.IsVM() {
				desired, err = r.ownerGatewayServiceFor(ctx, desired, owner)
				if err != nil {
					return fmt.Errorf("reading gateway service: %v", err)
				}
			}
			if liveGatewaySvc, err = ensureGatewayService(ctx, r.client, desired, "agent", name); err != nil {
				return fmt.Errorf("ensuring gateway service: %v", err)
			}
			return nil
		},
	)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}
	timer.mark("agentObjects")

	idleTimeout := effectiveIdleTimeout(agent.Spec.HibernationTimeout, agent.Spec.IsVM(), r.config.AgentBase)
	running := shouldRunMigrating(agent.Annotations, migration, idleTimeout, time.Now().UTC())

	lastActivity := agent.Annotations[annLastActivity]
	alwaysOn := idleTimeout <= 0
	autoRetry := alwaysOn || agent.Annotations[annSweepable] == "true" || migration.keepsUp()
	overBudget := ""
	parked := false
	if running {
		if !autoRetry && r.wakeAlreadyDenied(name, lastActivity) {
			running = false
			parked = true
		} else {
			refusal, err := r.budgetAllows(ctx, agent, owner)
			if err != nil {
				return fmt.Errorf("agent %s: budget check: %w", name, err)
			}
			if refusal != "" && !migration.keepsUp() {
				freed, err := r.reclaimIdleRoom(ctx, agent, owner)
				if err != nil {
					return fmt.Errorf("agent %s: reclaiming idle room: %w", name, err)
				}
				if freed {
					if refusal, err = r.budgetAllows(ctx, agent, owner); err != nil {
						return fmt.Errorf("agent %s: budget re-check: %w", name, err)
					}
				}
			}
			if refusal != "" {
				running = false
				parked = true
				overBudget = refusal
				if !autoRetry {
					r.recordDeniedWake(name, lastActivity)
				}
			} else {
				r.clearDeniedWake(name)
			}
		}
	}

	if running {
		refusal, err := r.resizeAllows(ctx, agent, owner)
		if err != nil {
			return fmt.Errorf("agent %s: resize budget check: %w", name, err)
		}
		if refusal != "" {
			running = false
			parked = true
			overBudget = refusal
			if !autoRetry {
				r.recordDeniedWake(name, lastActivity)
			}
			if err := scaleAgentPairToZero(ctx, r.client, r.HaltMachine, owner, r.config.Namespace, name); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("parking resized-over-budget pair: %v", err))
			}
		}
	}

	if parked && autoRetry {
		r.recordParkedRetry(name)
	} else {
		r.clearParkedRetry(name)
	}

	rollRev := agent.Annotations[annRollRev]

	gatewayIP := liveGatewaySvc.Spec.ClusterIP

	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("agent %s: gateway Service ClusterIP not yet assigned, requeuing", name)
	}

	hardStop := migration.stopHolds(agent.Annotations) || agent.Annotations[annStorageMigration] != ""
	_, served := desiredUpRecord(liveGatewaySvc)
	served = served && r.ownerGatewayServes(agentSpec)
	applyGateway := func() error {
		if served {
			if err := recordDesiredUp(ctx, r.client, r.config.Namespace, name, running && !hardStop); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("recording whether the agent should run: %v", err))
			}
			if moved {
				r.deleteOwnGateway(ctx, name)
			}
			return nil
		}
		machineGatewayIP := ""
		if agentSpec.IsVM() {
			machineGatewayIP = gatewayIP
		}
		gatewaySS := BuildGatewayStatefulSet(name, owner, !running, machineGatewayIP, r.config, ownerRef, credentialSecrets, agentSpec.L7Hosts, agentSpec.RequireConnectionAddress)
		stampRollRev(gatewaySS, rollRev)
		if err := r.applyStatefulSet(ctx, gatewaySS, running); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("applying gateway statefulset: %v", err))
		}
		if err := r.forceRollStuckPod(ctx, gatewaySS.Namespace, gatewaySS.Name); err != nil {
			slog.Warn("force-rolling stuck gateway pod failed; rollout may be deadlocked",
				"namespace", gatewaySS.Namespace, "statefulset", gatewaySS.Name, "error", err)
		}
		if running {
			if err := r.refreshGatewayCredentials(ctx, gatewaySS.Name, credentialSecrets); err != nil {
				slog.Warn("asking the kubelet to refresh gateway credentials failed; the periodic refresh still applies",
					"agent", name, "error", err)
			}
		}
		timer.mark("gatewayStatefulSet")
		return nil
	}
	// UNIT_BOUNDARY_DESCRIPTION: a waking gateway pod takes longer to start than the machine or agent pod beside it, mostly for the pod network and the kubelet's relist once a second, so it is scaled up before the agent side rather than after the runner call. The runner can still refuse a vm machine for lack of room, so a vm agent whose last start was refused, or one with no status yet, keeps the old order: a parked agent retried every 30 s must not start and stop a gateway pod each time. A runtime migration and a gateway going down also keep their place after the agent side, because a vm agent that is not running reads from its gateway whether it was hibernated.
	lastReady := apimeta.FindStatusCondition(agent.Status.Conditions, apiv1.ConditionReady)
	runnerAccepted := !agentSpec.IsVM() || (lastReady != nil && lastReady.Reason != apiv1.ReasonOverBudget)
	gatewayUp := running && !hardStop && !migration.active() && runnerAccepted && !served
	if gatewayUp {
		if err := applyGateway(); err != nil {
			return err
		}
		if err := r.publishGatewayTurnedReady(ctx, agent); err != nil {
			return fmt.Errorf("agent %s: publishing gateway readiness: %w", name, err)
		}
		timer.mark("gatewayReadiness")
	}
	var machine vmrunner.MachineStatus
	var runnerReached bool
	var migrationVMErr error
	if migration.requested {
		if err := r.beginRuntimeMigration(ctx, agent, &migration); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("starting runtime migration: %v", err))
		}
	}
	if agentSpec.IsVM() {
		if !r.config.VM.Enabled {
			return r.setError(ctx, name, "vm backend requested but virtualization is disabled in this install (virtualization.enabled)")
		}
		if err := r.prepareRuntimeMigration(ctx, agent, migration); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("preparing runtime migration: %v", err))
		}
		if _, refusal, err := r.renderedSpec(ctx, agent); err == nil {
			secretRefused = refusal
		}
		machineRuns := running
		pairAtRest := false
		if !running && !hardStop && !parked && !migration.holdsDown() {
			if machineRuns, err = r.pairAwake(ctx, name); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("reading gateway statefulset: %v", err))
			}
			pairAtRest = !machineRuns && !migration.active()
		}
		machine, runnerReached, err = r.reconcileVMAgent(ctx, agent, ownerRef, gatewayIP, machineRuns && migration.machineMayRun(), true)
		if stderrors.Is(err, errLeafSecretPending) || stderrors.Is(err, errRunnerTLSPending) {
			r.publishCertificateWait(ctx, agent, err)
			return fmt.Errorf("agent %s: %w, requeuing", name, err)
		}
		if err != nil {
			return r.setMachineError(ctx, agent, err)
		}
		r.noteMachineUse(name, machine)
		timer.mark("vmMachine")
		// UNIT_BOUNDARY_DESCRIPTION: the hibernation the idle checker or reclaim began, finished once the runner reports the machine stopped; until then the agent reads as not ready, so a wake waits for readiness instead of trusting the first health check answer.
		if pairAtRest && runnerReached && machineStopped(machine) && (lastReady == nil || lastReady.Reason != apiv1.ReasonHibernated) {
			if err := publishHibernated(ctx, r.dynamic, r.config.Namespace, name); err != nil {
				return fmt.Errorf("agent %s: publishing hibernation: %w", name, err)
			}
		}
		if migration.active() {
			migration.held = runtimeMigrationBootHeld(migration, overBudget)
			if err := r.continueRuntimeMigration(ctx, agent, migration, machine, runnerReached, nil); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("continuing runtime migration: %v", err))
			}
		}
		if machine.Reason == vmrunner.ReasonOutOfCapacity {
			running, parked, overBudget = false, true, r.vmMemoryFullMessage(ctx, agent, owner)
			r.recordParkedRetry(name)
			if err := r.reclaimForRefusedStart(ctx, agent, owner); err != nil {
				return fmt.Errorf("agent %s: reclaiming runner memory: %w", name, err)
			}
		}
	} else {
		podSpec, refusal, err := r.renderedSpec(ctx, agent)
		if err != nil {
			return r.setError(ctx, name, err.Error())
		}
		secretRefused = refusal
		agentSS := BuildAgentStatefulSet(name, podSpec, r.config, ownerRef, gatewayIP)
		claims, err := r.resolveWorkspaceClaims(ctx, agent, agentSpec)
		if err != nil {
			return r.setError(ctx, name, fmt.Sprintf("resolving warm-pool claims: %v", err))
		}
		timer.mark("workspaceClaims")
		applyPoolClaims(agentSS, claims)
		stampRollRev(agentSS, rollRev)
		if err := r.applyStatefulSet(ctx, agentSS, running && !migration.containerDown()); err != nil {
			live, getErr := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
			if errors.IsNotFound(getErr) {
				live, getErr = nil, nil
			}
			if failure := admissionStartFailure(err, live, agentSpec.Image); getErr == nil && failure.reason != "" {
				if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
					setStartFailure(s, failure, agent.Generation)
				}); err != nil {
					slog.Warn("writing agent admission start failure", "agent", name, "error", err)
				}
			}
			return r.setError(ctx, name, fmt.Sprintf("applying agent statefulset: %v", err))
		}
		if err := r.forceRollStuckPod(ctx, agentSS.Namespace, agentSS.Name); err != nil {
			slog.Warn("force-rolling stuck agent pod failed; rollout may be deadlocked",
				"namespace", agentSS.Namespace, "statefulset", agentSS.Name, "error", err)
		}
		if migration.containerDown() {
			if err := r.stopContainerForRuntimeMigration(ctx, name); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("stopping the container for its runtime migration: %v", err))
			}
		}
		timer.mark("agentStatefulSet")
		if !migration.vmSideRuns() {
			if err := r.applyService(ctx, BuildAgentService(name, r.config, ownerRef)); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("applying agent service: %v", err))
			}
		}
		timer.mark("agentService")
		if migration.active() && migration.phase != apiv1.ReasonRuntimeMigrationFailed && r.requeue != nil {
			r.requeue(name, runtimeMigrationPoll)
		}
		if migration.requested {
			machine, runnerReached, migrationVMErr = r.reconcileMigrationMachine(ctx, agent, ownerRef, gatewayIP, running && migration.machineMayRun(), migration.vmSideRuns())
			timer.mark("migrationMachine")
		}
		if migration.active() {
			migration.held = runtimeMigrationBootHeld(migration, overBudget)
			if err := r.continueRuntimeMigration(ctx, agent, migration, machine, runnerReached, migrationVMErr); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("continuing runtime migration: %v", err))
			}
		}
	}

	if !gatewayUp || !running || served {
		if err := applyGateway(); err != nil {
			return err
		}
	}

	if hardStop {
		if err := hibernateAgentPair(ctx, r.client, r.dynamic, r.HaltMachine, owner, r.config.Namespace, name); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("stopping agent: %v", err))
		}
		err = r.publishReconciled(ctx, agent)
		timer.mark("hardStop")
		return err
	}

	if running {
		if agentSpec.IsVM() {
			err = r.publishVMReadiness(ctx, agent, machine, runnerReached)
		} else {
			err = r.publishReadiness(ctx, agent)
		}
		timer.mark("readiness")
		return err
	}
	if parked {
		if err := scaleAgentPairToZero(ctx, r.client, r.HaltMachine, owner, r.config.Namespace, name); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("scaling down parked agent pair: %v", err))
		}
	}
	if overBudget != "" {
		err = r.publishOverBudget(ctx, agent, overBudget)
		timer.mark("overBudget")
		return err
	}
	err = r.publishReconciled(ctx, agent)
	timer.mark("reconciled")
	return err
}

// UNIT_BOUNDARY_DESCRIPTION: whether the idle checker has yet to hibernate the Agent, read off its gateway, which the checker scales to zero with the machine. A lapsed idle timeout alone must not stop a vm machine, as it never scales a container down: only the checker also asks agent-runtime whether it is busy. A gateway at zero whose machine did not stop, because the runner was unreachable, is stopped here on the next reconcile. It is read live: the checker scales the gateway down and then writes the status that requeues the Agent, and a cache that has not seen the scale yet would start the machine the checker just stopped.
func (r *AgentReconciler) pairAwake(ctx context.Context, name string) (bool, error) {
	if up, ok, err := r.servedDesiredUp(ctx, name); err != nil || ok {
		return up, err
	}
	ss, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, GatewayName(name), metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return ss.Spec.Replicas == nil || *ss.Spec.Replicas != 0, nil
}

func (r *AgentReconciler) publishReadiness(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	agentReady := r.podCurrentAndReady(ctx, name)
	agentPod, podReadErr := r.readPod(ctx, name)

	agentFailReason, agentFailMsg := "PodNotReady", ""
	if !agentReady {
		if reason, msg, ok := terminationReason(agentPod); ok {
			agentFailReason, agentFailMsg = reason, msg
		}
	}
	agentRestarts, agentRestartReason := podRestarts(agentPod)
	ss, ssReadErr := r.statefulSet(ctx, name, true)
	failure, recheck := podStartFailure(ss, agentPod, time.Now())
	if recheck > 0 && r.requeue != nil {
		r.requeue(name, recheck)
	}
	return r.publishReadinessOf(ctx, agent, agentReady, agentFailReason, agentFailMsg, podReadErr == nil, agentRestarts, agentRestartReason,
		func(s *apiv1.AgentStatus) {
			if podReadErr == nil && (ssReadErr == nil || errors.IsNotFound(ssReadErr)) {
				setStartFailure(s, failure, agent.Generation)
			}
		})
}

func (r *AgentReconciler) publishReadinessOf(ctx context.Context, agent *apiv1.Agent, agentReady bool, agentFailReason, agentFailMsg string, restartsObserved bool, agentRestarts int32, agentRestartReason string, also ...func(*apiv1.AgentStatus)) error {
	name := agent.Name
	gen := agent.Generation
	gatewayReady, gatewayFailReason, gatewayFailMsg := r.gatewayReadiness(ctx, agent)
	ready := agentReady && gatewayReady

	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, agentReady, "PodReady", agentFailReason, agentFailMsg, gen)
		setStatusCondition(s, apiv1.ConditionGatewayPodReady, gatewayReady, "PodReady", gatewayFailReason, gatewayFailMsg, gen)
		setStatusCondition(s, apiv1.ConditionReady, ready, "AllPodsReady", "PodsNotReady", "", gen)
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		if restartsObserved {
			s.AgentPodRestarts = agentRestarts
			s.AgentPodRestartReason = agentRestartReason
		}
		for _, mutate := range also {
			mutate(s)
		}
		s.ObservedGeneration = gen
	})
}

// UNIT_BOUNDARY_DESCRIPTION: on a wake the gateway pod is usually the last of the pair to turn ready, and the reconcile its readiness starts spends 100-300 ms on the runner call and the remaining applies before the full readiness publish. When the status already holds the agent side ready for this generation and only the gateway is missing, the gateway turning ready is published as soon as its StatefulSet is applied, by the same check the full publish makes; the rest of the reconcile then confirms or corrects it. The status is checked again as read for the write, so a reconcile working from a stale cache never publishes over a newer status.
func (r *AgentReconciler) publishGatewayTurnedReady(ctx context.Context, agent *apiv1.Agent) error {
	gen := agent.Generation
	pending := func(s *apiv1.AgentStatus) bool {
		agentSide := apimeta.FindStatusCondition(s.Conditions, apiv1.ConditionAgentPodReady)
		return s.ObservedGeneration == gen && agentSide != nil && agentSide.Status == metav1.ConditionTrue && agentSide.ObservedGeneration == gen &&
			apimeta.IsStatusConditionTrue(s.Conditions, apiv1.ConditionReconciled) &&
			!apimeta.IsStatusConditionTrue(s.Conditions, apiv1.ConditionGatewayPodReady)
	}
	if !pending(&agent.Status) || !r.podCurrentAndReady(ctx, GatewayName(agent.Name)) {
		return nil
	}
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		if pending(s) {
			setStatusCondition(s, apiv1.ConditionGatewayPodReady, true, "PodReady", "", "", gen)
			setStatusCondition(s, apiv1.ConditionReady, true, "AllPodsReady", "", "", gen)
		}
	})
}

func (r *AgentReconciler) gatewayReadiness(ctx context.Context, agent *apiv1.Agent) (bool, string, string) {
	if r.ownerGatewayServes(&agent.Spec) {
		if svc, err := r.client.CoreV1().Services(r.config.Namespace).Get(ctx, GatewayName(agent.Name), metav1.GetOptions{}); err == nil && svc.Annotations[annOwnerGatewayServed] == "true" {
			if ok, msg := r.ownerListenerCurrent(ctx, agent.Name, svc.Spec.ClusterIP, r.config.EnvoyPort); !ok {
				if r.requeue != nil {
					r.requeue(agent.Name, ownerListenerRecheck)
				}
				if reason, failure, failed := r.ownerGatewayFailure(ctx, agent.Labels[envoyOwnerLabel]); failed {
					return false, reason, failure
				}
				return false, apiv1.ReasonOwnerGatewayListenerStale, msg
			}
			return true, "", ""
		}
	}
	if r.podCurrentAndReady(ctx, GatewayName(agent.Name)) {
		return true, "", ""
	}
	reason, msg := r.gatewayNotReadyCause(ctx, GatewayName(agent.Name))
	return false, reason, msg
}

func (r *AgentReconciler) publishReconciled(ctx context.Context, agent *apiv1.Agent) error {
	gen := agent.Generation
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.ObservedGeneration = gen
	})
}

func podStuckOnSupersededRevision(ss *appsv1.StatefulSet, p *corev1.Pod) bool {
	if ss.Status.UpdateRevision == "" || ss.Status.ObservedGeneration != ss.Generation {
		return false
	}
	if p.Labels["controller-revision-hash"] == ss.Status.UpdateRevision {
		return false
	}
	return !isPodReady(*p)
}

func (r *AgentReconciler) gatewayNotReadyCause(ctx context.Context, ssName string) (reason, message string) {
	pod, _ := r.readPod(ctx, ssName)
	if pod == nil {
		return "PodNotReady", ""
	}
	if reason, msg, ok := terminationReason(pod); ok {
		return reason, msg
	}
	ss, err := r.statefulSet(ctx, ssName, true)
	if err != nil || !podStuckOnSupersededRevision(ss, pod) {
		return "PodNotReady", ""
	}
	return apiv1.ReasonStuckOnSupersededRevision, fmt.Sprintf(
		"gateway pod is on superseded revision %s (target %s) and cannot become ready; replacing it",
		pod.Labels["controller-revision-hash"], ss.Status.UpdateRevision)
}

func (r *AgentReconciler) podCurrentAndReady(ctx context.Context, ssName string) bool {
	ss, err := r.statefulSet(ctx, ssName, true)
	if err != nil {
		return false
	}
	if ss.Status.ObservedGeneration != ss.Generation {
		return false
	}
	pod, _ := r.readPod(ctx, ssName)
	if pod == nil {
		return false
	}
	return isPodReady(*pod) &&
		pod.Labels["controller-revision-hash"] == ss.Status.UpdateRevision
}

func (r *AgentReconciler) readPod(ctx context.Context, ssName string) (*corev1.Pod, error) {
	var pod *corev1.Pod
	var err error
	if r.podCache != nil {
		pod, err = r.podCache.Pods(r.config.Namespace).Get(ssName + "-0")
	} else {
		pod, err = r.client.CoreV1().Pods(r.config.Namespace).Get(ctx, ssName+"-0", metav1.GetOptions{})
	}
	if errors.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return pod, nil
}

// UNIT_BOUNDARY_DESCRIPTION: cert-manager does not own the Secrets it issues, so without this an issued Secret outlives what it was issued for.
func (r *AgentReconciler) ensureSecretOwnerReference(ctx context.Context, secretName string, known *corev1.Secret, ownerRef metav1.OwnerReference) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		sec := known
		var err error
		if sec == nil {
			sec, err = r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, secretName, metav1.GetOptions{})
		}
		known = nil
		if errors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if slices.ContainsFunc(sec.OwnerReferences, func(ref metav1.OwnerReference) bool { return ref.UID == ownerRef.UID }) {
			return nil
		}
		sec.OwnerReferences = append(sec.OwnerReferences, metav1.OwnerReference{
			APIVersion: ownerRef.APIVersion,
			Kind:       ownerRef.Kind,
			Name:       ownerRef.Name,
			UID:        ownerRef.UID,
		})
		_, err = r.client.CoreV1().Secrets(r.config.Namespace).Update(ctx, sec, metav1.UpdateOptions{})
		return err
	})
}

// UNIT_BOUNDARY_DESCRIPTION: cleans up after a deleted Agent. It runs on the controller's delete queue rather than in the informer's handler, because removing a vm agent's machine is a call to its owner's runner that can take seconds or fail outright; an error asks the queue to try again later, and every step is safe to repeat.
func (r *AgentReconciler) Delete(ctx context.Context, name, owner string) error {
	r.deleteReleaseNsAgentResources(ctx, name)

	r.deletePVCs(ctx, name)
	if err := r.deleteMachine(ctx, name, owner); err != nil {
		return err
	}
	r.vmRunning.Delete(name)
	r.vmDiskGrows.Delete(name)
	r.notReadyPolls.Delete(name)
	r.vmStartClocks.Delete(name)
	r.ownerGatewayRevisions.Delete(name)

	r.clearDeniedWake(name)
	r.clearParkedRetry(name)
	unresolvedGrants.forget(name)
	return nil
}

func AgentOwner(labels map[string]string) string {
	return labels[envoyOwnerLabel]
}

func (r *AgentReconciler) deleteReleaseNsAgentResources(ctx context.Context, agentName string) {
	svcName := r.config.ExtAuthzServiceName(agentName)
	if err := r.client.CoreV1().Services(r.config.ReleaseNamespace).Delete(ctx, svcName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		slog.Warn("deleting per-agent ext-authz Service", "service", svcName, "agent", agentName, "error", err)
	}
	for _, name := range []string{agentName + "-harness-allow", agentName + "-extauthz-allow"} {
		if err := r.dynamic.Resource(authzPolicyGVR).Namespace(r.config.ReleaseNamespace).
			Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			slog.Warn("deleting per-agent AuthorizationPolicy", "policy", name, "agent", agentName, "error", err)
		}
	}
}

func (r *AgentReconciler) deletePVCs(ctx context.Context, agentName string) {
	for _, selector := range []string{LabelAgent + "=" + agentName, LabelRetainedFor + "=" + agentName} {
		pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
			metav1.ListOptions{LabelSelector: selector},
		)
		if err != nil {
			slog.Warn("listing PVCs for agent", "agent", agentName, "selector", selector, "error", err)
			continue
		}
		for _, pvc := range pvcs.Items {
			if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil {
				slog.Warn("deleting PVC", "pvc", pvc.Name, "agent", agentName, "error", err)
			}
		}
	}
}

func (r *AgentReconciler) resolveWorkspaceClaims(ctx context.Context, agent *apiv1.Agent, agentSpec *apiv1.AgentSpec) (map[string]string, error) {
	name := agent.Name
	defaults := r.config.AgentTemplateDefaults

	persisted := map[string]bool{}
	for _, mnt := range resolveSpecMounts(agentSpec, defaults) {
		if mnt.Persist {
			persisted[sanitizeMountName(mnt.Path)] = true
		}
	}

	sts, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		claims := map[string]string{}
		for _, v := range sts.Spec.Template.Spec.Volumes {
			if v.PersistentVolumeClaim != nil && persisted[v.Name] {
				claims[v.Name] = v.PersistentVolumeClaim.ClaimName
			}
		}
		return claims, nil
	}
	if !errors.IsNotFound(err) {
		return nil, err
	}
	if err := r.refuseOverRetainedVolumes(ctx, name); err != nil {
		return nil, err
	}

	claimed, err := r.listClaimedPoolPVCs(ctx, name)
	if err != nil {
		return nil, err
	}
	claims := map[string]string{}
	for mount, pvc := range claimed {
		if persisted[mount] {
			claims[mount] = pvc
		}
	}
	if !r.config.WarmPool.Enabled {
		return claims, nil
	}
	if pin := agentSpec.StorageClass; pin != "" && pin != r.config.WarmPool.StorageClass {
		return claims, nil
	}

	targets := poolTargets(r.config.WarmPool)
	for _, mnt := range resolveSpecMounts(agentSpec, defaults) {
		if !mnt.Persist {
			continue
		}
		volName := sanitizeMountName(mnt.Path)
		if _, ok := claims[volName]; ok {
			continue
		}
		key, ok := matchPoolKey(targets, effectiveMountSize(mnt, agentSpec, defaults))
		if !ok {
			continue
		}
		pvcName, err := r.claimSpare(ctx, name, key, volName)
		if err != nil {
			return nil, err
		}
		if pvcName != "" {
			claims[volName] = pvcName
		}
	}
	return claims, nil
}

func (r *AgentReconciler) listClaimedPoolPVCs(ctx context.Context, agentName string) (map[string]string, error) {
	list, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + agentName,
	})
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, p := range list.Items {
		if _, fromPool := p.Labels[LabelPool]; !fromPool {
			continue
		}
		if mount := p.Labels[LabelMount]; mount != "" {
			out[mount] = p.Name
		}
	}
	return out, nil
}

func (r *AgentReconciler) claimSpare(ctx context.Context, agentName, poolKey, mountName string) (string, error) {
	list, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelPool + "=" + poolKey + "," + LabelPoolAvailable + "=true",
	})
	if err != nil {
		return "", err
	}
	for i := range list.Items {
		p := &list.Items[i]
		if p.Status.Phase != corev1.ClaimBound {
			continue
		}
		if p.Labels == nil {
			p.Labels = map[string]string{}
		}
		p.Labels[LabelAgent] = agentName
		p.Labels[LabelMount] = mountName
		delete(p.Labels, LabelPoolAvailable)
		if _, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Update(ctx, p, metav1.UpdateOptions{}); err != nil {
			if errors.IsConflict(err) || errors.IsNotFound(err) {
				continue
			}
			return "", err
		}
		slog.Info("warm pool: claimed spare for agent", "agent", agentName, "pool", poolKey, "mount", mountName, "pvc", p.Name)
		return p.Name, nil
	}
	return "", nil
}

func (r *AgentReconciler) ReconcileOrphanPVCs(ctx context.Context) {
	pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
		metav1.ListOptions{LabelSelector: LabelAgent},
	)
	if err != nil {
		slog.Warn("orphan PVC GC: listing PVCs failed", "error", err)
		return
	}
	deleted := 0
	for _, pvc := range pvcs.Items {
		agentName := pvc.Labels[LabelAgent]
		if agentName == "" {
			continue
		}
		_, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, agentName, metav1.GetOptions{})
		if err == nil {
			continue
		}
		if !errors.IsNotFound(err) {
			slog.Warn("orphan PVC GC: API lookup failed", "agent", agentName, "error", err)
			continue
		}
		if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil {
			slog.Warn("orphan PVC GC: delete failed", "pvc", pvc.Name, "agent", agentName, "error", err)
			continue
		}
		slog.Info("orphan PVC GC: deleted PVC for missing agent", "pvc", pvc.Name, "agent", agentName)
		deleted++
	}
	if deleted > 0 {
		slog.Info("orphan PVC GC: sweep complete", "deleted", deleted, "scanned", len(pvcs.Items))
	}
}

func (r *AgentReconciler) ReconcileOrphanLeafSecrets(ctx context.Context) {
	secrets, err := r.client.CoreV1().Secrets(r.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("orphan leaf Secret GC: listing Secrets failed", "error", err)
		return
	}
	deleted := 0
	scanned := 0
	for _, sec := range secrets.Items {
		agentName, ok := agentNameFromLeafSecret(sec)
		if !ok {
			continue
		}
		scanned++
		_, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, agentName, metav1.GetOptions{})
		if err == nil {
			continue
		}
		if !errors.IsNotFound(err) {
			slog.Warn("orphan leaf Secret GC: API lookup failed", "agent", agentName, "error", err)
			continue
		}
		if err := r.client.CoreV1().Secrets(r.config.Namespace).Delete(ctx, sec.Name, metav1.DeleteOptions{}); err != nil {
			slog.Warn("orphan leaf Secret GC: delete failed", "secret", sec.Name, "agent", agentName, "error", err)
			continue
		}
		slog.Info("orphan leaf Secret GC: deleted Secret for missing agent", "secret", sec.Name, "agent", agentName)
		deleted++
	}
	if deleted > 0 {
		slog.Info("orphan leaf Secret GC: sweep complete", "deleted", deleted, "scanned", scanned)
	}
}

func agentNameFromLeafSecret(sec corev1.Secret) (string, bool) {
	if sec.Type != corev1.SecretTypeTLS {
		return "", false
	}
	name, ok := strings.CutSuffix(sec.Name, envoyLeafSecretSuffix)
	return name, ok && name != ""
}

func (r *AgentReconciler) setError(ctx context.Context, name, msg string) error {
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		if c := apimeta.FindStatusCondition(s.Conditions, apiv1.ConditionReconciled); c != nil && c.Reason == "BackoffLimitExceeded" {
			return
		}
		setStatusCondition(s, apiv1.ConditionReconciled, false, "Reconciled", "ReconcileError", msg, 0)
	}); err != nil {
		slog.Warn("writing agent reconcile-error status", "agent", name, "error", err)
	}
	return fmt.Errorf("agent %s: %s", name, msg)
}

func (r *AgentReconciler) SetBackoffExceeded(ctx context.Context, name string, attempts int, cause error) {
	msg := fmt.Sprintf("reconcile failed %d times, retrying with capped backoff: %v", attempts, cause)
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, false, "Reconciled", "BackoffLimitExceeded", msg, 0)
	}); err != nil {
		slog.Warn("writing agent backoff-exceeded status", "agent", name, "error", err)
	}
}

func stampRollRev(ss *appsv1.StatefulSet, rollRev string) {
	if rollRev == "" {
		return
	}
	if ss.Spec.Template.Annotations == nil {
		ss.Spec.Template.Annotations = map[string]string{}
	}
	ss.Spec.Template.Annotations[annRollRev] = rollRev
}

// UNIT_BOUNDARY_DESCRIPTION: writes an agent's or gateway's StatefulSet only when it would change. Every reconcile renders both, and one agent worker serves many owners, so an update that waits holds up the start of every agent behind it on that worker. An update waits for every admission webhook that matches StatefulSets, even when it changes nothing, and a webhook whose service has no ready endpoint can hold it until the webhook's timeout (10-12 s measured). The stored template carries the API server's defaults and never equals the rendered one, so the rendered template and update strategy are hashed onto the StatefulSet, and an unchanged hash with the right replica count sends nothing. The cost: a hand edit to the template stays until the rendered template next changes.
func (r *AgentReconciler) applyStatefulSet(ctx context.Context, desired *appsv1.StatefulSet, running bool) error {
	hash := templateHash(desired.Spec.Template, desired.Spec.UpdateStrategy)
	fromCache := r.statefulSets != nil
	return retry.OnError(retry.DefaultRetry, func(err error) bool {
		stale := fromCache && (errors.IsAlreadyExists(err) || errors.IsNotFound(err))
		fromCache = false
		return stale || errors.IsConflict(err)
	}, func() error {
		existing, err := r.statefulSet(ctx, desired.Name, fromCache)
		if errors.IsNotFound(err) {
			replicas := int32(0)
			if running {
				replicas = 1
			}
			desired.Spec.Replicas = &replicas
			metav1.SetMetaDataAnnotation(&desired.ObjectMeta, annStatefulSetTemplate, hash)
			_, err = r.client.AppsV1().StatefulSets(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		scaled := !running || (existing.Spec.Replicas != nil && *existing.Spec.Replicas == 1)
		if scaled && existing.Annotations[annStatefulSetTemplate] == hash {
			return nil
		}
		if running {
			one := int32(1)
			existing.Spec.Replicas = &one
		}
		existing.Spec.Template = desired.Spec.Template
		existing.Spec.UpdateStrategy = desired.Spec.UpdateStrategy
		metav1.SetMetaDataAnnotation(&existing.ObjectMeta, annStatefulSetTemplate, hash)
		updated, err := r.client.AppsV1().StatefulSets(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		if err == nil && r.statefulSets != nil {
			r.statefulSets.Mutation(updated)
		}
		return err
	})
}

func templateHash(template corev1.PodTemplateSpec, strategy any) string {
	raw, _ := json.Marshal([]any{template, strategy})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:8])
}

// UNIT_BOUNDARY_DESCRIPTION: the StatefulSet comes from the cache, and the pods from another one, so the pods can be newer: a pod the StatefulSet controller just created for a new revision looks stuck against a cached StatefulSet that has not seen that revision yet. A pod is deleted only after a live read of the StatefulSet still finds it stuck, which costs a GET only when there is a pod to delete.
func (r *AgentReconciler) forceRollStuckPod(ctx context.Context, namespace, statefulSetName string) error {
	ss, err := r.statefulSet(ctx, statefulSetName, true)
	if errors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("getting statefulset: %w", err)
	}
	if ss.Status.UpdateRevision == "" || ss.Status.ObservedGeneration != ss.Generation {
		return nil
	}
	sel, err := metav1.LabelSelectorAsSelector(ss.Spec.Selector)
	if err != nil {
		return fmt.Errorf("building selector: %w", err)
	}
	var pods []*corev1.Pod
	if r.podCache != nil {
		pods, err = r.podCache.Pods(namespace).List(sel)
	} else {
		var list *corev1.PodList
		if list, err = r.client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()}); err == nil {
			for i := range list.Items {
				pods = append(pods, &list.Items[i])
			}
		}
	}
	if err != nil {
		return fmt.Errorf("listing pods: %w", err)
	}
	confirmed := r.statefulSets == nil
	for _, p := range pods {
		if !podStuckOnSupersededRevision(ss, p) {
			continue
		}
		if p.DeletionTimestamp != nil {
			continue
		}
		if !confirmed {
			if ss, err = r.statefulSet(ctx, statefulSetName, false); errors.IsNotFound(err) {
				return nil
			} else if err != nil {
				return fmt.Errorf("getting statefulset: %w", err)
			}
			confirmed = true
			if !podStuckOnSupersededRevision(ss, p) {
				continue
			}
		}
		slog.Info("force-rolling StatefulSet pod stuck on a superseded revision",
			"namespace", namespace, "statefulset", statefulSetName, "pod", p.Name,
			"podRev", p.Labels["controller-revision-hash"],
			"currentRev", ss.Status.CurrentRevision, "targetRev", ss.Status.UpdateRevision)
		if err := r.client.CoreV1().Pods(namespace).Delete(ctx, p.Name, metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &p.UID, ResourceVersion: &p.ResourceVersion}}); err != nil && !errors.IsNotFound(err) && !errors.IsConflict(err) {
			return fmt.Errorf("deleting stuck pod %s: %w", p.Name, err)
		}
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: creates the Service once and leaves it as it is, except that a headless one replaces one with a cluster address: a runtime migration that is aborted after its boot leaves the Service a machine needs, and a Service's cluster address cannot be changed in place.
func (r *AgentReconciler) applyService(ctx context.Context, desired *corev1.Service) error {
	cli := r.client.CoreV1().Services(desired.Namespace)
	existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
	if err == nil && desired.Spec.ClusterIP == corev1.ClusterIPNone && existing.Spec.ClusterIP != corev1.ClusterIPNone {
		if err = cli.Delete(ctx, desired.Name, metav1.DeleteOptions{}); err == nil || errors.IsNotFound(err) {
			err = errors.NewNotFound(corev1.Resource("services"), desired.Name)
		}
	}
	if errors.IsNotFound(err) {
		_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	return err
}

var certificateGVR = schema.GroupVersionResource{
	Group:    "cert-manager.io",
	Version:  "v1",
	Resource: "certificates",
}

func (r *AgentReconciler) applyCertificate(ctx context.Context, desired *Certificate) error {
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(desired)
	if err != nil {
		return fmt.Errorf("encoding Certificate: %w", err)
	}
	desiredU := &unstructured.Unstructured{Object: raw}
	desiredU.SetAPIVersion(certificateGVR.GroupVersion().String())
	desiredU.SetKind("Certificate")
	return r.applyUnstructured(ctx, certificateGVR, desiredU)
}

func (r *AgentReconciler) applyUnstructured(ctx context.Context, gvr schema.GroupVersionResource, desired *unstructured.Unstructured) error {
	cli := r.dynamic.Resource(gvr).Namespace(desired.GetNamespace())
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := cli.Get(ctx, desired.GetName(), metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		if unstructuredCurrent(existing, desired) {
			return nil
		}
		desired.SetResourceVersion(existing.GetResourceVersion())
		_, err = cli.Update(ctx, desired, metav1.UpdateOptions{})
		return err
	})
}

func unstructuredCurrent(existing, desired *unstructured.Unstructured) bool {
	for _, field := range [][]string{{"spec"}, {"metadata", "labels"}, {"metadata", "annotations"}, {"metadata", "ownerReferences"}} {
		have, _, _ := unstructured.NestedFieldNoCopy(existing.Object, field...)
		want, _, _ := unstructured.NestedFieldNoCopy(desired.Object, field...)
		haveJSON, errHave := json.Marshal(have)
		wantJSON, errWant := json.Marshal(want)
		if errHave != nil || errWant != nil || !bytes.Equal(haveJSON, wantJSON) {
			return false
		}
	}
	return true
}

func (r *AgentReconciler) applyConfigMap(ctx context.Context, desired *corev1.ConfigMap) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.CoreV1().ConfigMaps(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().ConfigMaps(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		if maps.Equal(existing.Data, desired.Data) && maps.Equal(existing.Labels, desired.Labels) &&
			equality.Semantic.DeepEqual(existing.OwnerReferences, desired.OwnerReferences) {
			return nil
		}
		existing.Data = desired.Data
		existing.OwnerReferences = desired.OwnerReferences
		existing.Labels = desired.Labels
		_, err = r.client.CoreV1().ConfigMaps(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

func concurrently(steps ...func() error) error {
	errs := make([]error, len(steps))
	var wg sync.WaitGroup
	for i, step := range steps {
		wg.Go(func() { errs[i] = step() })
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
