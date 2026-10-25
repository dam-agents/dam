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
	"k8s.io/apimachinery/pkg/types"
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
	parkedRetry           map[string]struct{}
	memoryGraces          map[string]memoryGrace
	memoryWaitWrites      sync.Map
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
	backend               AgentBackend
	anchors               bool
	absorbed              func(context.Context) error
	anchorOrphanSince     sync.Map
	releaseNsOrphanSince  sync.Map
	agentCache            cache.GenericLister
	agentCacheSynced      cache.InformerSynced
	podCache              corelisters.PodLister
	statefulSets          cache.MutationCache
	runnerDeploys         cache.MutationCache
	runnerPodCache        corelisters.PodLister
	nodeCache             corelisters.NodeLister
	nodeCacheSynced       cache.InformerSynced
	vmRunning             sync.Map
	vmLive                sync.Map
	vmAnswers             sync.Map
	grantHolds            sync.Map
	holdHeld              sync.Map
	grantProbes           sync.Map
	noNodeResize          sync.Map
	steppedSince          sync.Map
	vmDiskGrows           sync.Map
	vmPools               sync.Map
	usageSecrets          sync.Map
	resizeNotices         sync.Map
	claimNotices          sync.Map
	runnerCapacity        sync.Map
	runnerUnavailable     sync.Map
	nodeLostNotices       sync.Map
	nodeLostLast          atomic.Int64
	unavailableLast       atomic.Int64
	poolLevels            sync.Map
	notReadyPolls         sync.Map
	vmStartClocks         sync.Map
	ownerless             sync.Map
	orphanMachines        sync.Map
	machineWatchMu        sync.Mutex
	machineWatches        map[string]*machineWatch
	pressureWatches       map[string]*machineWatch
	memoryPassMu          sync.Mutex
	memoryPassing         map[string]bool
	pressureFreed         map[string]time.Time
	preflightMu           sync.Mutex
	preflight             vmPreflightResult
	preflightDone         bool
	ownerGatewayRevisions sync.Map
	ownerGatewayRefused   sync.Map
	ownerGatewayAnswered  sync.Map
	// UNIT_BOUNDARY_DESCRIPTION: the revision a member's listener carries under the previous two-volume layout, which hashes differently because its credential root does. Readiness and cutover accept either, so a retained old-layout pod is not called stale while it serves; only a canonical answer ever authorises a repair, because the two layouts are separate publications and the canonical one is no receipt for the other.
	ownerGatewayLegacyRevisions sync.Map
	// UNIT_BOUNDARY_DESCRIPTION: the arrival epoch the revision the owner last published for an agent encodes. Recorded with the revision and adopted with it, so a probe answer can be matched to the epoch it is evidence about.
	ownerGatewayEpochs sync.Map
	ownerGatewayOffers sync.Map
	clock              func() time.Time
	ownerGatewayBudget int
	ownerProbeClient   *http.Client
}

func NewAgentReconciler(client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config) *AgentReconciler {
	r := &AgentReconciler{client: client, dynamic: dyn, config: cfg, rollViewTTL: runnerRollViewTTL,
		backend: crAgentBackend{dynamic: dyn, namespace: cfg.Namespace}}
	r.busyProbe = func(ctx context.Context, name string) bool {
		idle, answered := agentIdleStatus(ctx, r.config.Namespace, name)
		return answered && !idle
	}
	r.podStatus = func(ctx context.Context, name string) (bool, bool) {
		return agentIdleStatus(ctx, r.config.Namespace, name)
	}
	return r
}

func (r *AgentReconciler) WithAgentCache(lister cache.GenericLister) *AgentReconciler {
	r.agentCache = lister
	return r
}

// UNIT_BOUNDARY_DESCRIPTION: a cache that has not listed yet reads as an owner with no agents, and that is a different statement from an owner whose agents are gone: rendering on it drains a serving owner's listeners, and tearing down on it deletes a gateway that still serves. So work the controller starts before the caches are synced asks here first and waits.
func (r *AgentReconciler) WithAgentCacheSynced(synced cache.InformerSynced) *AgentReconciler {
	r.agentCacheSynced = synced
	return r
}

// UNIT_BOUNDARY_DESCRIPTION: WithAgentBackend points the reconciler at the Agent store it reconciles.
// UNIT_BOUNDARY_DESCRIPTION: A store that does not let the controller write a definition also means the
// UNIT_BOUNDARY_DESCRIPTION: children are owned by the Agent's anchor rather than by an object in the
// UNIT_BOUNDARY_DESCRIPTION: cluster that no longer exists.
func (r *AgentReconciler) WithAgentBackend(backend AgentBackend) *AgentReconciler {
	r.backend = backend
	r.anchors = !backend.SpecWritable()
	return r
}

// UNIT_BOUNDARY_DESCRIPTION: WithAbsorbedCheck is the database's half of the fence: every sweep that can
// UNIT_BOUNDARY_DESCRIPTION: delete asks it first, so a store this cluster never moved into cannot be read
// UNIT_BOUNDARY_DESCRIPTION: as an empty fleet. Nil in CRD mode, where there is no store to check.
func (r *AgentReconciler) WithAbsorbedCheck(check func(context.Context) error) *AgentReconciler {
	r.absorbed = check
	return r
}

func (r *AgentReconciler) assertStoreAbsorbed(ctx context.Context) error {
	if r.absorbed == nil {
		return nil
	}
	return r.absorbed(ctx)
}

// UNIT_BOUNDARY_DESCRIPTION: AssertStoreAbsorbed is the gate the passes outside a reconcile call before
// UNIT_BOUNDARY_DESCRIPTION: they collect anything.
func (r *AgentReconciler) AssertStoreAbsorbed(ctx context.Context) error {
	return r.assertStoreAbsorbed(ctx)
}

func (r *AgentReconciler) updateStatus(ctx context.Context, name string, mutate func(*apiv1.AgentStatus)) error {
	return r.backend.UpdateStatus(ctx, name, mutate)
}

func (r *AgentReconciler) patchAgent(ctx context.Context, name string, ann map[string]*string) error {
	return r.backend.PatchAgent(ctx, name, ann)
}

// UNIT_BOUNDARY_DESCRIPTION: stampAnnotation is the controller's own writes to an Agent: the machine and
// UNIT_BOUNDARY_DESCRIPTION: OOM marks are status columns, and the reclaim mark is the signals CAS.
func (r *AgentReconciler) stampAnnotation(ctx context.Context, name, key, value, resourceVersion string) error {
	if key == annReclaimedAt {
		return r.backend.StampReclaim(ctx, name, value, resourceVersion)
	}
	return r.backend.PatchAgent(ctx, name, map[string]*string{key: &value})
}

func (r *AgentReconciler) backendHealthy() error {
	if r.backend == nil {
		return nil
	}
	return r.backend.Healthy()
}

// UNIT_BOUNDARY_DESCRIPTION: whether the agent cache can answer at all. A reconciler built without one — the tests — reads agents live, so it can always answer.
func (r *AgentReconciler) agentCacheReady() bool {
	return r.agentCache == nil || r.agentCacheSynced == nil || r.agentCacheSynced()
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

// UNIT_BOUNDARY_DESCRIPTION: a not-ready agent's reconcile asks about a node, and the requeue behind it runs from three seconds to a minute, so on a lost node the ask scales with the number of agents waiting there. The node watch answers instead, as the runner pods' cache does, and its sync decides whether it can answer at all: a watch that has not synced reads as a node that cannot be read, never as a node that is gone. The cache is not waited for at startup, since a cluster without the node read permission must still run everything else. A reconciler built without the cache — the tests — reads nodes live.
func (r *AgentReconciler) WithNodeCache(lister corelisters.NodeLister, synced cache.InformerSynced) *AgentReconciler {
	r.nodeCache, r.nodeCacheSynced = lister, synced
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

// UNIT_BOUNDARY_DESCRIPTION: the reconciler's clock, so a test drives the repair pacing without waiting for it.
func (r *AgentReconciler) clockNow() time.Time {
	if r.clock != nil {
		return r.clock()
	}
	return time.Now()
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
	timer := newReconcileTimer(ctx, "agent", name)
	defer timer.done()

	owner := agent.Labels["agent-platform.ai/owner"]

	// UNIT_BOUNDARY_DESCRIPTION: a store that cannot answer is no basis for a decision that stops, moves or deletes anything. The reconcile retries instead, so a database outage leaves every machine exactly as it was.
	if err := r.backendHealthy(); err != nil {
		return fmt.Errorf("agent %s: %w", name, err)
	}

	ownerRef, err := r.childrenOwner(ctx, agent)
	if err != nil {
		return err
	}
	agentSpec := &agent.Spec

	if r.backend.SpecWritable() {
		if err := r.ensureConcreteSize(ctx, agent); err != nil {
			return fmt.Errorf("agent %s: %w", name, err)
		}
	}

	credentialSecrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, name, owner,
		agentSpec.GrantedSecretIDs, agentSpec.GrantedConnectionIDs)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("listing credential secrets: %v", err))
	}
	timer.mark("credentials")

	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(name, agentSpec.TelemetryAttributionID, r.config, ownerRef, credentialSecrets, agentSpec.L7Hosts, agentSpec.RequireConnectionAddress)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("rendering envoy bootstrap: %v", err))
	}
	var liveGatewaySvc *corev1.Service
	onOwnerGateway, err := r.onOwnerGateway(ctx, name)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("reading gateway service: %v", err))
	}
	ownerGatewayOn := r.ownerGatewayOn(owner)
	moved := onOwnerGateway && ownerGatewayOn
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
			if ownerGatewayOn || onOwnerGateway {
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
			if ownerGatewayOn || onOwnerGateway {
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
		ownGateway(func() error {
			return applyNetworkPolicy(ctx, r.client, BuildGatewayIngressNetworkPolicy(name, owner, r.config, ownerRef))
		}),
		ownGateway(func() error {
			return applyNetworkPolicy(ctx, r.client, BuildGatewayEgressNetworkPolicy(name, r.config, ownerRef))
		}),
		func() (err error) {
			desired, err := r.ownerGatewayServiceFor(ctx, BuildGatewayService(name, r.config, ownerRef), owner)
			if err != nil {
				return fmt.Errorf("reading gateway service: %v", err)
			}
			if liveGatewaySvc, err = ensureGatewayService(ctx, r.client, desired, "agent", name, r.anchors); err != nil {
				return fmt.Errorf("ensuring gateway service: %v", err)
			}
			return nil
		},
	)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}
	if onOwnerGateway && !r.config.VM.Gateway.PerOwner {
		lock := r.ownerLock(owner)
		lock.Lock()
		_, err := r.ensureOwnerGateway(ctx, owner)
		lock.Unlock()
		if err != nil {
			slog.Warn("owner gateway: not applied for the agents still on it", "owner", owner, "agent", name, "error", err)
		}
	}
	timer.mark("agentObjects")

	idleTimeout := effectiveIdleTimeout(agent.Spec.HibernationTimeout, r.config.AgentBase)
	running := shouldRun(agent.Annotations, idleTimeout, time.Now().UTC())

	lastActivity := agent.Annotations[annLastActivity]
	overBudget := ""
	awaiting, awaitingReason := "", ""
	parked := false
	r.clearParkedRetry(name)

	rollRev := agent.Annotations[annRollRev]

	gatewayIP := liveGatewaySvc.Spec.ClusterIP

	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("agent %s: gateway Service ClusterIP not yet assigned, requeuing", name)
	}

	hardStop := agent.Annotations[annStopRequested] != ""
	_, served := desiredUpRecord(liveGatewaySvc)
	served = served && ownerGatewayOn
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
		machineGatewayIP := gatewayIP
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
			recheck, err := r.refreshGatewayCredentials(ctx, gatewaySS.Name, credentialSecrets, time.Now())
			if err != nil {
				slog.Warn("asking the kubelet to refresh gateway credentials failed; the periodic refresh still applies",
					"agent", name, "error", err)
			}
			if recheck > 0 && r.requeue != nil {
				r.requeue(name, recheck)
			}
		}
		timer.mark("gatewayStatefulSet")
		return nil
	}
	// UNIT_BOUNDARY_DESCRIPTION: a waking gateway pod takes longer to start than the machine beside it, mostly for the pod network and the kubelet's relist once a second, so it is scaled up before the runner call. The runner can still refuse a machine for lack of room, so an agent whose last start was refused or is waiting for the node, or one with no status yet, keeps the other order: a parked agent retried every few seconds must not start and stop a gateway pod each time.
	lastReady := apimeta.FindStatusCondition(agent.Status.Conditions, apiv1.ConditionReady)
	// UNIT_BOUNDARY_DESCRIPTION: a start the runner refused for the owner's storage is answered the same way until space frees, so this pass keeps the old order rather than start a gateway pod the refusal will scale down again.
	parkedLast := lastReady != nil && (lastReady.Reason == apiv1.ReasonOverBudget || lastReady.Reason == apiv1.ReasonAwaitingAllocation || lastReady.Reason == apiv1.ReasonAwaitingWarmUp || lastReady.Reason == apiv1.ReasonAwaitingMemory || lastReady.Reason == apiv1.ReasonAllocationUnreadable || lastReady.Reason == vmrunner.ReasonStorageFull)
	runnerAccepted := lastReady != nil && !parkedLast
	gatewayUp := running && !hardStop && runnerAccepted && !served
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
	if _, refusal, err := r.renderedSpec(ctx, agent); err == nil {
		secretRefused = refusal
	}
	machineRuns := running
	pairAtRest := false
	if !running && !hardStop {
		if machineRuns, err = r.pairAwake(ctx, name); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("reading gateway statefulset: %v", err))
		}
		pairAtRest = !machineRuns
	}
	machine, runnerReached, err = r.reconcileVMAgent(ctx, agent, ownerRef, gatewayIP, machineRuns)
	if stderrors.Is(err, errLeafSecretPending) || stderrors.Is(err, errRunnerTLSPending) {
		r.publishCertificateWait(ctx, agent, err)
		return fmt.Errorf("agent %s: %w, requeuing", name, err)
	}
	if err != nil {
		return r.setMachineError(ctx, agent, err)
	}
	// UNIT_BOUNDARY_DESCRIPTION: the sample is kept under the owner's lock, the one the runner's answer was recorded under, so a pass that read a status before that answer cannot keep the older reading after it.
	machineLock := r.ownerLock(owner)
	machineLock.Lock()
	r.noteMachineUse(name, machine)
	machineLock.Unlock()
	// UNIT_BOUNDARY_DESCRIPTION: the machine's episode is stamped as it is watched, so a kill of the runner can later be held to the machines that were on it: a machine started after a kill is no victim of it, and one booting at the kill is.
	if stamped, err := r.stampMachine(ctx, agent, machine, runnerReached); err != nil {
		slog.Warn("stamping the machine's episode", "agent", name, "error", err)
	} else {
		agent = stamped
	}
	timer.mark("vmMachine")
	// UNIT_BOUNDARY_DESCRIPTION: the hibernation the idle checker or reclaim began, finished once the runner reports the machine stopped; until then the agent reads as not ready, so a wake waits for readiness instead of trusting the first health check answer. It is published on every reconcile of a resting agent rather than only the first, so a kill that took its machine down comes off AgentPodReady once its episode ends: nothing else writes that condition on an agent that stays asleep.
	if pairAtRest && runnerReached && machineStopped(machine) {
		if _, err := r.publishKill(ctx, agent, hibernatedStatus); err != nil {
			return fmt.Errorf("agent %s: publishing hibernation: %w", name, err)
		}
	}
	// UNIT_BOUNDARY_DESCRIPTION: a start the wave of a restart holds back is
	// UNIT_BOUNDARY_DESCRIPTION: not the owner's memory being full: the machines
	// UNIT_BOUNDARY_DESCRIPTION: the runner is bringing back fill the pool at their
	// UNIT_BOUNDARY_DESCRIPTION: warm-up floors and settle below it, so the start
	// UNIT_BOUNDARY_DESCRIPTION: waits for them rather than hibernate one of them,
	// UNIT_BOUNDARY_DESCRIPTION: and reads as a start in progress so a wake waits for
	// UNIT_BOUNDARY_DESCRIPTION: it. The window is read from the runner pod, so it is
	// UNIT_BOUNDARY_DESCRIPTION: the same one after a controller restart, and past it
	// UNIT_BOUNDARY_DESCRIPTION: the owner's idle agents are the room the start has.
	// UNIT_BOUNDARY_DESCRIPTION: A refusal whose own reclaim hibernated an idle agent
	// UNIT_BOUNDARY_DESCRIPTION: for it is a wait rather than a refusal: the room that
	// UNIT_BOUNDARY_DESCRIPTION: agent holds frees within seconds, so the parked retry
	// UNIT_BOUNDARY_DESCRIPTION: starts this one by itself and the owner is not asked to
	// UNIT_BOUNDARY_DESCRIPTION: free room the platform is making. It is read as a start
	// UNIT_BOUNDARY_DESCRIPTION: in progress, and asked for again at the machine watch's
	// UNIT_BOUNDARY_DESCRIPTION: cadence so it does not wait the half minute of the parked
	// UNIT_BOUNDARY_DESCRIPTION: tick. A refusal nothing has freed room for inside
	// UNIT_BOUNDARY_DESCRIPTION: memoryReclaimWait is the pool's again: it reads
	// UNIT_BOUNDARY_DESCRIPTION: OverBudget with the message that says what frees it, so a
	// UNIT_BOUNDARY_DESCRIPTION: pool that cannot hold the start never reads as a start
	// UNIT_BOUNDARY_DESCRIPTION: that is merely slow. A plan the runner did not refuse for room
	// UNIT_BOUNDARY_DESCRIPTION: is a start that got in or one that stopped, so its wait ends with
	// UNIT_BOUNDARY_DESCRIPTION: it: a refusal after it is a new question rather than the wait of
	// UNIT_BOUNDARY_DESCRIPTION: the room freed before. The wait is stamped by the agents the
	// UNIT_BOUNDARY_DESCRIPTION: reclaim put to sleep, before a later one's failure ends this
	// UNIT_BOUNDARY_DESCRIPTION: pass: those side effects stand, so the retry finds the room
	// UNIT_BOUNDARY_DESCRIPTION: and this start is no more a refusal than if every agent had
	// UNIT_BOUNDARY_DESCRIPTION: gone to sleep.
	if machine.Reason == vmrunner.ReasonOutOfCapacity {
		running, parked = false, true
		r.recordParkedRetry(name)
		if r.runnerWarmingUp(ctx, owner) {
			awaiting, awaitingReason = vmAwaitingWarmUpMessage, apiv1.ReasonAwaitingWarmUp
		} else {
			r.retryMemoryWait(ctx, name)
			freed, err := r.reclaimForRefusedStart(ctx, agent, owner, func() (int, error) { return r.runnerLimitMiB(ctx, owner) })
			if freed > 0 {
				_ = r.noteMemoryWait(ctx, name)
			}
			waiting := freed > 0 || r.memoryWaiting(agent)
			if waiting {
				// UNIT_BOUNDARY_DESCRIPTION: the wait this start has had is all it gets: past
				// UNIT_BOUNDARY_DESCRIPTION: it the refusal is the pool's rather than the start
				// UNIT_BOUNDARY_DESCRIPTION: of a grace of its own.
				r.markMemoryGraced(name, lastActivity)
			} else if waiting = r.memoryGrace(name, lastActivity); !waiting {
				if clearErr := r.clearMemoryWait(ctx, agent); clearErr != nil && err == nil {
					err = clearErr
				}
			}
			if err != nil {
				return fmt.Errorf("agent %s: reclaiming runner memory: %w", name, err)
			}
			if waiting {
				awaiting, awaitingReason = vmAwaitingMemoryMessage, apiv1.ReasonAwaitingMemory
				if r.requeue != nil {
					r.requeue(name, vmReadinessPoll)
				}
			} else {
				overBudget = r.vmMemoryFullMessage(ctx, agent, owner)
			}
		}
	} else if err := r.clearMemoryWait(ctx, agent); err != nil {
		return fmt.Errorf("agent %s: clearing the memory wait: %w", name, err)
	} else {
		// UNIT_BOUNDARY_DESCRIPTION: a start that got in or stopped ends the memory refusal of this Agent, and the grace spent on one of its starts with it.
		r.clearMemoryGrace(name)
	}
	// UNIT_BOUNDARY_DESCRIPTION: a start the runner's own limit had room for and the node had not yet granted is not the owner's memory being full: the controller asks the node for that memory with an in-place resize in this same reconcile, so the Agent is retried at the machine watch's cadence rather than at the parked tick, and the owner's idle agents are not hibernated for room the node is already being asked for. It is published under its own reason, so a wake waits for the start instead of failing on it.
	if machine.Reason == vmrunner.ReasonAwaitingAllocation {
		// UNIT_BOUNDARY_DESCRIPTION: an answer about a machine that is still coming up is never parked: parking stops the machine, and a boot or a restart the runner already admitted runs to completion whatever this second answer says. A runner current with this controller lets such a machine through instead of answering, and one from before it answers exactly here, so this is where the exemption is kept for the rollout rather than in the runner alone.
		bootInFlight := holdsMemory(machine.State)
		if !bootInFlight {
			running, parked, awaiting, awaitingReason = false, true, vmAwaitingAllocationMessage, apiv1.ReasonAwaitingAllocation
			r.recordParkedRetry(name)
		}
		if r.requeue != nil {
			r.requeue(name, vmReadinessPoll)
		}
		// UNIT_BOUNDARY_DESCRIPTION: a grant below what one more machine costs is answered by asking the node for less, not by freeing anything: an idle agent hibernated now is taken away while the smaller ask is still on its way, and the two would have fitted. The reclaim starts only once this same ask has been with the node for a grace and the node still has not granted it, where the owner's idle agents are the only room left.
		if !bootInFlight && r.runnerResizePending(ctx, owner) && !r.reclaimWaitsForTheReducedAsk(owner) {
			if _, err := r.reclaimForRefusedStart(ctx, agent, owner, func() (int, error) { return r.runnerAdmitMiB(ctx, owner) }); err != nil {
				return fmt.Errorf("agent %s: reclaiming runner memory: %w", name, err)
			}
		}
	}
	// UNIT_BOUNDARY_DESCRIPTION: a start the runner refused because the owner's storage is full holds nothing, so the Agent is parked with the runner's own explanation: the gateway comes down with the machine it proxies, and the parked tick asks again, which is what starts the Agent once space frees. Only a start of an Agent that should run is parked, and only when the machine is stopped or absent: an Agent that should be asleep keeps the hibernation it is already under, since a refusal from a machine it asked to keep stopped must not wake its status between the two, and a machine in any other state may still hold memory, which parking halts.
	if running && machine.Reason == vmrunner.ReasonStorageFull && machineStopped(machine) {
		running, parked, awaiting, awaitingReason = false, true, machine.Message, vmrunner.ReasonStorageFull
		r.recordParkedRetry(name)
	}
	// UNIT_BOUNDARY_DESCRIPTION: a start held on a node that has not reported what it granted keeps holding past the bound, but it stops promising an automatic start in seconds: it is published under a reason of its own that names the problem and is retried at the parked tick, so a person sees the diagnosis instead of a start that reads as coming up for ever.
	if machine.Reason == apiv1.ReasonAllocationUnreadable {
		running, parked, awaiting, awaitingReason = false, true, vmAllocationUnreadableMessage, apiv1.ReasonAllocationUnreadable
		r.recordParkedRetry(name)
	}

	if !gatewayUp || !running || served {
		if err := applyGateway(); err != nil {
			return err
		}
	}

	if hardStop {
		if _, err := hibernateAgentPair(ctx, r.client, r.backend, r.HaltMachine, owner, r.config.Namespace, name); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("stopping agent: %v", err))
		}
		err = r.publishReconciled(ctx, agent)
		timer.mark("hardStop")
		return err
	}

	if running {
		err = r.publishVMReadiness(ctx, agent, machine, runnerReached)
		timer.mark("readiness")
		return err
	}
	if parked {
		if err := scaleAgentPairToZero(ctx, r.client, r.HaltMachine, owner, r.config.Namespace, name); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("scaling down parked agent pair: %v", err))
		}
	}
	// UNIT_BOUNDARY_DESCRIPTION: a refusal for room and a start waiting for the node are published under their own reason on Ready, which is what the budget surfaces and the parked retry read, and the kill goes on AgentPodReady in the same update, so the owner still hears what took their machine down.
	own := func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", agent.Generation)
		s.ObservedGeneration = agent.Generation
	}
	switch {
	case overBudget != "":
		own = func(s *apiv1.AgentStatus) { parkStatus(s, agent.Generation, apiv1.ReasonOverBudget, overBudget) }
		timer.mark("overBudget")
	case awaiting != "":
		own = func(s *apiv1.AgentStatus) { parkStatus(s, agent.Generation, awaitingReason, awaiting) }
		timer.mark("awaitingAllocation")
	default:
		timer.mark("reconciled")
	}
	_, err = r.publishKill(ctx, agent, own)
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
func (r *AgentReconciler) publishReadinessOf(ctx context.Context, agent *apiv1.Agent, agentReady bool, agentFailReason, agentFailMsg string, restartsObserved bool, agentRestarts int32, agentRestartReason string, also ...func(*apiv1.AgentStatus)) error {
	name := agent.Name
	gen := agent.Generation
	gatewayReady, gatewayFailReason, gatewayFailMsg := r.gatewayReadiness(ctx, agent)
	ready := agentReady && gatewayReady

	return r.updateStatus(ctx, name, func(s *apiv1.AgentStatus) {
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
	return r.updateStatus(ctx, agent.Name, func(s *apiv1.AgentStatus) {
		if pending(s) {
			setStatusCondition(s, apiv1.ConditionGatewayPodReady, true, "PodReady", "", "", gen)
			setStatusCondition(s, apiv1.ConditionReady, true, "AllPodsReady", "", "", gen)
		}
	})
}

func (r *AgentReconciler) gatewayReadiness(ctx context.Context, agent *apiv1.Agent) (bool, string, string) {
	if r.ownerGatewayOn(agent.Labels[envoyOwnerLabel]) {
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
			// UNIT_BOUNDARY_DESCRIPTION: a listener that answers the current revision still leaves the provider unbuilt if its credential file arrived late, and the repair for it cannot be made while a rollout has two pods; reporting ready here would hide the one case where traffic is unsigned on a gateway that looks healthy.
			if r.ownerGatewayOwesThisRepair(agent.Labels[envoyOwnerLabel], agent.Name) {
				return false, apiv1.ReasonOwnerGatewayListenerStale, "the owner gateway has not loaded this agent's credentials yet"
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
	return r.updateStatus(ctx, agent.Name, func(s *apiv1.AgentStatus) {
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
		if r.anchors {
			sec.OwnerReferences = adoptOwnerRefs(sec.OwnerReferences, metav1.OwnerReference{
				APIVersion: ownerRef.APIVersion,
				Kind:       ownerRef.Kind,
				Name:       ownerRef.Name,
				UID:        ownerRef.UID,
			})
		} else {
			sec.OwnerReferences = append(sec.OwnerReferences, metav1.OwnerReference{
				APIVersion: ownerRef.APIVersion,
				Kind:       ownerRef.Kind,
				Name:       ownerRef.Name,
				UID:        ownerRef.UID,
			})
		}
		_, err = r.client.CoreV1().Secrets(r.config.Namespace).Update(ctx, sec, metav1.UpdateOptions{})
		return err
	})
}

// UNIT_BOUNDARY_DESCRIPTION: cleans up after a deleted Agent. It runs on the controller's delete queue rather than in the informer's handler, because removing a vm agent's machine is a call to its owner's runner that can take seconds or fail outright; an error asks the queue to try again later, and every step is safe to repeat. The Agent is read live first, because a queued cleanup can run three quarters of an hour after the delete: a name that another Agent holds now is left alone, with its machine, home and objects, and one the same Agent still holds waits for the queue.
func (r *AgentReconciler) Delete(ctx context.Context, name, owner string, uid types.UID) error {
	if r.anchors {
		return r.deleteByAnchor(ctx, name)
	}
	live, err := r.backend.Get(ctx, name)
	switch {
	case err == nil && live.GetUID() != uid:
		slog.Info("deleted agent cleanup: the name belongs to an agent created since, nothing is removed", "agent", name, "uid", uid, "live", live.GetUID())
		return nil
	case err == nil:
		return fmt.Errorf("the deleted agent is still there")
	case !errors.IsNotFound(err):
		return fmt.Errorf("reading the deleted agent: %w", err)
	}

	if err := r.deleteReleaseNsAgentResources(ctx, name); err != nil {
		slog.Warn("deleted agent cleanup: release-namespace resources remain", "agent", name, "error", err)
	}
	if err := r.deletePVCs(ctx, name); err != nil {
		slog.Warn("deleted agent cleanup: PVCs remain", "agent", name, "error", err)
	}
	if err := r.deleteMachine(ctx, name, owner); err != nil {
		return err
	}
	r.vmRunning.Delete(name)
	r.vmAnswers.Delete(name)
	r.vmDiskGrows.Delete(name)
	r.notReadyPolls.Delete(name)
	r.vmStartClocks.Delete(name)
	r.ownerGatewayRevisions.Delete(name)
	r.ownerGatewayAnswered.Delete(name)
	r.ownerGatewayLegacyRevisions.Delete(name)
	r.ownerGatewayEpochs.Delete(name)

	r.clearParkedRetry(name)
	r.memoryWaitWrites.Delete(name)
	unresolvedGrants.forget(name)
	return nil
}

func AgentOwner(labels map[string]string) string {
	return labels[envoyOwnerLabel]
}

// UNIT_BOUNDARY_DESCRIPTION: the resources a release-namespace delete cannot cascade, because owner references do not cross namespaces. The errors are the caller's: with anchors, the anchor is the durable delete marker and one that is removed while these survive is a delete nobody retries.
func (r *AgentReconciler) deleteReleaseNsAgentResources(ctx context.Context, agentName string) error {
	var errs []error
	svcName := r.config.ExtAuthzServiceName(agentName)
	if err := r.client.CoreV1().Services(r.config.ReleaseNamespace).Delete(ctx, svcName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		errs = append(errs, fmt.Errorf("deleting per-agent ext-authz Service %s: %w", svcName, err))
	}
	for _, name := range []string{agentName + "-harness-allow", agentName + "-extauthz-allow"} {
		if err := r.dynamic.Resource(authzPolicyGVR).Namespace(r.config.ReleaseNamespace).
			Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			errs = append(errs, fmt.Errorf("deleting per-agent AuthorizationPolicy %s: %w", name, err))
		}
	}
	return stderrors.Join(errs...)
}

func (r *AgentReconciler) deletePVCs(ctx context.Context, agentName string) error {
	var errs []error
	for _, selector := range []string{LabelAgent + "=" + agentName} {
		pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
			metav1.ListOptions{LabelSelector: selector},
		)
		if err != nil {
			errs = append(errs, fmt.Errorf("listing PVCs for agent %s: %w", agentName, err))
			continue
		}
		for _, pvc := range pvcs.Items {
			if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
				errs = append(errs, fmt.Errorf("deleting PVC %s: %w", pvc.Name, err))
			}
		}
	}
	return stderrors.Join(errs...)
}
func (r *AgentReconciler) ReconcileOrphanLeafSecrets(ctx context.Context) {
	if err := r.assertStoreAbsorbed(ctx); err != nil {
		slog.Warn("orphan leaf Secret GC: skipped, the Agent store is not the absorbed one", "error", err)
		return
	}
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
		_, err := r.backend.Get(ctx, agentName)
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
	if err := r.updateStatus(ctx, name, func(s *apiv1.AgentStatus) {
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
	if err := r.updateStatus(ctx, name, func(s *apiv1.AgentStatus) {
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
			if !r.anchors || len(desired.OwnerReferences) == 0 {
				return nil
			}
			if slices.ContainsFunc(existing.OwnerReferences, func(ref metav1.OwnerReference) bool { return ref.UID == desired.OwnerReferences[0].UID }) {
				return nil
			}
			existing.OwnerReferences = adoptOwnerRefs(existing.OwnerReferences, desired.OwnerReferences[0])
			updated, err := r.client.AppsV1().StatefulSets(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
			if err == nil && r.statefulSets != nil {
				r.statefulSets.Mutation(updated)
			}
			return err
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

// UNIT_BOUNDARY_DESCRIPTION: creates the Service once and leaves it as it is, except that a headless one replaces one with a cluster address: a machine needs a Service it can remap a published port on, and a cluster address cannot be changed in place.
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
	if err != nil || !r.anchors || len(desired.OwnerReferences) == 0 {
		return err
	}
	if slices.ContainsFunc(existing.OwnerReferences, func(ref metav1.OwnerReference) bool { return ref.UID == desired.OwnerReferences[0].UID }) {
		return nil
	}
	existing.OwnerReferences = adoptOwnerRefs(existing.OwnerReferences, desired.OwnerReferences[0])
	_, err = cli.Update(ctx, existing, metav1.UpdateOptions{})
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
