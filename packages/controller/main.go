package main

import (
	"context"
	"fmt"
	"hash/fnv"
	"log/slog"
	"maps"
	"os"
	"os/signal"
	"slices"
	"sync"
	"syscall"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/sets"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/informers"
	coreinformers "k8s.io/client-go/informers/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/leaderelection"
	"k8s.io/client-go/tools/leaderelection/resourcelock"
	"k8s.io/client-go/util/workqueue"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/agentstore"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/crdcheck"
	"github.com/dam-agents/dam/packages/controller/pkg/reconciler"
	"github.com/dam-agents/dam/packages/controller/pkg/store"
	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
)

func main() {
	level := logLevel()

	telemetryShutdown, telemetryEnabled, telemetryErr := telemetry.Setup(context.Background())
	slog.SetDefault(slog.New(telemetry.NewHandler(level, telemetryEnabled)))
	if telemetryErr != nil {
		slog.Warn("telemetry setup failed; continuing without export", "error", telemetryErr)
	}
	if telemetryEnabled {
		slog.Info("telemetry export enabled")
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := telemetryShutdown(shutdownCtx); err != nil {
				slog.Warn("telemetry shutdown", "error", err)
			}
		}()
	}

	cfg, err := config.LoadFromEnv()
	if err != nil {
		slog.Error("loading config", "error", err)
		os.Exit(1)
	}

	restCfg, err := rest.InClusterConfig()
	if err != nil {
		slog.Error("loading in-cluster config", "error", err)
		os.Exit(1)
	}

	// UNIT_BOUNDARY_DESCRIPTION: a reconcile spends almost all of its time waiting for this limiter rather than for the API server. Measured on a 80-agent install: each reconcile issues around thirty calls, every one of them answered in single-digit milliseconds and then followed by a wait until the next token — twenty milliseconds apart at fifty a second, which is where a 700 ms reconcile goes. The drift sweep hands the queue every agent at once, so the fleet costs thirty calls times its size, and an agent created during that window waits behind all of it. Raising the ceiling is what shortens that wait: the agent workers all queue for the same tokens, since the limiter is shared, so more workers buy no throughput, and the API server was never the thing saying no.
	if restCfg.QPS == 0 {
		restCfg.QPS = 200
		restCfg.Burst = 400
	}
	slog.Info("kube client rate limits", "qps", restCfg.QPS, "burst", restCfg.Burst)

	restCfg.Wrap(telemetry.WrapTransport)

	client, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		slog.Error("creating k8s client", "error", err)
		os.Exit(1)
	}
	dynClient, err := dynamic.NewForConfig(restCfg)
	if err != nil {
		slog.Error("creating dynamic client", "error", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	markerName := cfg.AgentStoreMarker
	if markerName == "" {
		markerName = agentstore.MarkerName(cfg.ReleaseName)
	}
	marker, err := agentstore.ReadMarker(ctx, client, cfg.Namespace, markerName)
	if err != nil {
		slog.Error("reading the agent store marker", "name", markerName, "error", err)
		os.Exit(1)
	}
	if refusal := agentstore.Refusal(cfg.AgentStore, marker); refusal != "" {
		slog.Error("refusing to start", "agentStore", cfg.AgentStore, "reason", refusal)
		os.Exit(1)
	}

	if err := crdcheck.Assert(ctx, dynClient); err != nil {
		slog.Error("CRD schema check failed", "error", err)
		os.Exit(1)
	}

	lock := &resourcelock.LeaseLock{
		LeaseMeta: metav1.ObjectMeta{Name: cfg.LeaseName, Namespace: cfg.Namespace},
		Client:    client.CoordinationV1(),
		LockConfig: resourcelock.ResourceLockConfig{
			Identity: cfg.PodName,
		},
	}

	leaderelection.RunOrDie(ctx, leaderelection.LeaderElectionConfig{
		Lock:            lock,
		LeaseDuration:   15 * time.Second,
		RenewDeadline:   10 * time.Second,
		RetryPeriod:     2 * time.Second,
		ReleaseOnCancel: true,
		Callbacks: leaderelection.LeaderCallbacks{
			OnStartedLeading: func(ctx context.Context) {
				run(ctx, client, dynClient, cfg)
			},
			OnStoppedLeading: func() {
				slog.Info("lost leadership")
			},
		},
	})
}

func logLevel() slog.Level {
	level := slog.LevelInfo
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		if err := level.UnmarshalText([]byte(v)); err != nil {
			slog.Warn("invalid LOG_LEVEL; defaulting to info", "value", v, "error", err)
			level = slog.LevelInfo
		}
	}
	return level
}

func run(ctx context.Context, client kubernetes.Interface, dynClient dynamic.Interface, cfg *config.Config) {
	slog.Info("started leading", "namespace", cfg.Namespace, "agentStore", cfg.AgentStore)

	// UNIT_BOUNDARY_DESCRIPTION: The rows are the Agent source in Postgres mode, so no informer watches
	// UNIT_BOUNDARY_DESCRIPTION: the custom resources there. Everything else — pods, machines, Secrets,
	// UNIT_BOUNDARY_DESCRIPTION: nodes — is still Kubernetes, and is wired the same in both modes.
	var postgres *store.Store
	if cfg.AgentStore == agentstore.ModePostgres {
		var err error
		postgres, err = store.Open(ctx, cfg.DatabaseURL, cfg.Namespace, cfg.DatabaseCAPath)
		if err != nil {
			slog.Error("opening the Agent store", "error", err)
			return
		}
		defer postgres.Close()
	}

	var dynFactory dynamicinformer.DynamicSharedInformerFactory
	var agentInformer informers.GenericInformer
	if postgres == nil {
		dynFactory = dynamicinformer.NewFilteredDynamicSharedInformerFactory(dynClient, 30*time.Second, cfg.Namespace, nil)
		agentInformer = dynFactory.ForResource(reconciler.AgentsGVR)
	}

	podFactory := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = reconciler.LabelAgent
		}),
	)
	podInformer := podFactory.Core().V1().Pods()
	stripManagedFields := informers.WithTransform(func(obj interface{}) (interface{}, error) {
		if m, err := meta.Accessor(obj); err == nil {
			m.SetManagedFields(nil)
		}
		return obj, nil
	})
	statefulSetInformer := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = reconciler.LabelAgent
		}),
		stripManagedFields,
	).Apps().V1().StatefulSets().Informer()

	agentReconciler := reconciler.NewAgentReconciler(client, dynClient, cfg).WithPodCache(podInformer.Lister()).WithStatefulSetCache(statefulSetInformer)
	if postgres != nil {
		agentReconciler.WithAgentBackend(postgres).WithAgentCache(postgres.Lister()).WithAgentCacheSynced(postgres.Synced)
	} else {
		agentReconciler.WithAgentCache(agentInformer.Lister()).WithAgentCacheSynced(agentInformer.Informer().HasSynced)
	}

	var runnerInformer, runnerPodInformer, nodeInformer cache.SharedIndexInformer
	runnerFactory := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = "app.kubernetes.io/component=vm-runner"
		}),
		stripManagedFields,
	)
	runnerInformer = runnerFactory.Apps().V1().Deployments().Informer()
	runnerPods := runnerFactory.Core().V1().Pods()
	runnerPodInformer = runnerPods.Informer()
	agentReconciler.WithRunnerCaches(runnerInformer, runnerPods.Lister())
	// UNIT_BOUNDARY_DESCRIPTION: nodes are cluster-scoped, so they take a factory of their own. A not-ready agent's reconcile asks about a node on every retry, and on a lost node those retries add up across the owner's agents. The watch keeps only the name and the Ready condition: the rest of a node object carries every image and attached volume of a shared cluster to answer one question.
	nodes := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second, informers.WithTransform(func(obj interface{}) (interface{}, error) {
		if node, ok := obj.(*corev1.Node); ok {
			ready := make([]corev1.NodeCondition, 0, 1)
			for _, c := range node.Status.Conditions {
				if c.Type == corev1.NodeReady {
					ready = append(ready, c)
				}
			}
			node.ManagedFields, node.Labels, node.Annotations = nil, nil, nil
			node.Status = corev1.NodeStatus{Conditions: ready}
		}
		return obj, nil
	})).Core().V1().Nodes()
	nodeInformer = nodes.Informer()
	agentReconciler.WithNodeCache(nodes.Lister(), nodeInformer.HasSynced)

	idleChecker := reconciler.NewIdleChecker(client, dynClient, cfg).WithMachineHalt(agentReconciler.HaltMachine).WithOwnerLock(agentReconciler.OwnerLock)
	if postgres != nil {
		idleChecker.WithAgentBackend(postgres)
	}
	agentReconciler.CheckVMInstall(ctx)
	go every(ctx, 5*time.Minute, func() { agentReconciler.CheckVMInstall(ctx) })
	go idleChecker.RunLoop(ctx)

	deleteQueue := workqueue.NewTypedRateLimitingQueueWithConfig(
		workqueue.NewTypedItemExponentialFailureRateLimiter[deletedAgent](time.Second, 5*time.Minute),
		workqueue.TypedRateLimitingQueueConfig[deletedAgent]{Name: "agent-delete"})
	defer deleteQueue.ShutDown()

	// UNIT_BOUNDARY_DESCRIPTION: a pass that collects machines or anchors makes a decision about a fleet it cannot see if the store stopped answering. Both the deletion record and the machine list are durable, so waiting costs nothing a later pass does not recover.
	orphanSweep := func() {
		sctx, finish := telemetry.StartPass(ctx, "orphan sweep")
		start := time.Now()
		if err := agentReconciler.StoreHealthy(); err != nil {
			slog.WarnContext(sctx, "orphan sweep skipped: the Agent store is not answering", "error", err)
			finish(err)
			return
		}
		agentReconciler.ReconcileOrphanLeafSecrets(sctx)
		agentReconciler.ReconcileOrphanMachines(sctx)
		if err := agentReconciler.ReconcileOrphanAnchors(sctx, func(name string) {
			deleteQueue.Add(deletedAgent{name: name})
		}); err != nil {
			slog.WarnContext(sctx, "anchor sweep failed", "error", err)
		}
		slog.DebugContext(sctx, "orphan sweep complete", "duration", time.Since(start))
		finish(nil)
	}
	go func() {
		orphanSweep()
		every(ctx, 10*time.Minute, orphanSweep)
	}()
	rolloutSweep := func() {
		sctx, finish := telemetry.StartPass(ctx, "runner rollout sweep")
		agentReconciler.ReconcileRunnerRollout(sctx)
		finish(nil)
	}
	go func() {
		rolloutSweep()
		every(ctx, 10*time.Minute, rolloutSweep)
	}()

	var agentLister cache.GenericNamespaceLister
	if postgres != nil {
		agentLister = postgres.Lister().ByNamespace(cfg.Namespace)
	} else {
		agentLister = agentInformer.Lister().ByNamespace(cfg.Namespace)
	}
	agentQueue := newShardedAgentQueue(agentLister)
	defer agentQueue.ShutDown()
	agentReconciler.WithRequeue(ctx, func(name string, after time.Duration) {
		if after == 0 {
			agentQueue.AddUrgent(name)
			return
		}
		agentQueue.AddAfter(name, after)
	})

	if postgres != nil {
		go postgres.Run(ctx, func(event store.Notify) {
			switch {
			case event.Table == "user_budgets":
				agentReconciler.ForgetVMPools()
			case event.Delete:
				deleteQueue.Add(deletedAgent{name: event.Name})
			case event.Name != "":
				agentQueue.add(!event.Urgent, event.Name)
			}
		})
		waitForStore(ctx, postgres)
		// UNIT_BOUNDARY_DESCRIPTION: the anchors come before any delete is worked: a deletion that happened while the controller was down is already in the queue, and removing the previous incarnation's children needs the anchor of the current one to exist first.
		if err := agentReconciler.EnsureAnchors(ctx); err != nil {
			slog.Warn("the startup anchor pass is incomplete; the anchor sweep retries it", "error", err)
		} else if err := postgres.RecordAnchorsEnsured(ctx, cfg.PodName); err != nil {
			slog.Warn("recording the startup anchor pass failed", "error", err)
		}
		go runDeleteWorker(ctx, agentReconciler, deleteQueue)
	} else {
		agentInformer.Informer().AddEventHandler(cache.ResourceEventHandlerDetailedFuncs{
			AddFunc: func(obj interface{}, isInInitialList bool) {
				if u := unstructuredFrom(obj); u != nil {
					agentQueue.add(isInInitialList, u.GetName())
				}
			},
			UpdateFunc: func(oldObj, newObj interface{}) {
				if !resourceVersionChanged(oldObj, newObj) {
					return
				}
				if u := unstructuredFrom(newObj); u != nil {
					agentQueue.add(!specOrAnnotationsChanged(unstructuredFrom(oldObj), u), u.GetName())
				}
			},
			DeleteFunc: func(obj interface{}) {
				if u := unstructuredFrom(obj); u != nil {
					deleteQueue.Add(deletedAgent{name: u.GetName(), owner: reconciler.AgentOwner(u.GetLabels()), uid: u.GetUID()})
				}
			},
		})
		go runDeleteWorker(ctx, agentReconciler, deleteQueue)
	}

	requeueOwner := func(obj interface{}, isInInitialList bool) {
		if m, err := meta.Accessor(obj); err == nil {
			for _, name := range agentReconciler.OwnerVMAgents(reconciler.AgentOwner(m.GetLabels())) {
				agentQueue.add(isInInitialList, name)
			}
		}
	}
	if _, err := runnerInformer.AddEventHandler(cache.ResourceEventHandlerDetailedFuncs{
		AddFunc: requeueOwner,
		UpdateFunc: func(oldObj, newObj interface{}) {
			if resourceVersionChanged(oldObj, newObj) {
				requeueOwner(newObj, false)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				obj = tombstone.Obj
			}
			requeueOwner(obj, false)
		},
	}); err != nil {
		slog.Error("watching VM runner deployments", "error", err)
		return
	}
	runnerFactory.Start(ctx.Done())
	go nodeInformer.RunWithContext(ctx)

	podInformer.TypedInformer().AddTypedEventHandler(cache.TypedResourceEventHandlerDetailedFuncs[*corev1.Pod]{
		AddFunc: func(pod *corev1.Pod, isInInitialList bool) {
			agentQueue.add(isInInitialList, pod.Labels[reconciler.LabelAgent])
		},
		UpdateFunc: func(oldPod, newPod *corev1.Pod) {
			if oldPod.ResourceVersion == newPod.ResourceVersion {
				return
			}
			agentQueue.add(false, newPod.Labels[reconciler.LabelAgent])
		},
		DeleteFunc: func(deleted coreinformers.DeletedPod) {
			if deleted.OptionalObj != nil {
				agentQueue.add(false, deleted.OptionalObj.Labels[reconciler.LabelAgent])
			}
		},
	})

	secretFactory := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = reconciler.CredentialSecretSelector
		}),
		informers.WithTransform(func(obj interface{}) (interface{}, error) {
			if s, ok := obj.(*corev1.Secret); ok {
				s.Data, s.StringData = nil, nil
			}
			return obj, nil
		}),
	)
	secretInformer := secretFactory.Core().V1().Secrets()
	secretInformer.TypedInformer().AddTypedEventHandler(cache.TypedResourceEventHandlerDetailedFuncs[*corev1.Secret]{
		UpdateFunc: func(oldSecret, newSecret *corev1.Secret) {
			if oldSecret.ResourceVersion == newSecret.ResourceVersion {
				return
			}
			for _, a := range agentReconciler.OwnerAgents(reconciler.AgentOwner(newSecret.Labels)) {
				agentQueue.add(false, a.GetName())
			}
		},
	})

	if dynFactory != nil {
		dynFactory.Start(ctx.Done())
	}
	podFactory.Start(ctx.Done())
	secretFactory.Start(ctx.Done())
	go statefulSetInformer.RunWithContext(ctx)
	synced := []cache.InformerSynced{podInformer.Informer().HasSynced, secretInformer.Informer().HasSynced, statefulSetInformer.HasSynced, runnerInformer.HasSynced, runnerPodInformer.HasSynced}
	// UNIT_BOUNDARY_DESCRIPTION: a cluster that cannot read nodes still runs every other backend, so the node watch is not waited for here — it reports nothing until it syncs, rather than holding every backend's reconcile behind a permission the node role alone grants.
	if !cache.WaitForCacheSync(ctx.Done(), synced...) {
		slog.Error("failed to sync informer caches")
		return
	}
	slog.Info("informer caches synced")

	const driftInterval = 5 * time.Minute
	go every(ctx, driftInterval, func() {
		var n int
		if postgres != nil {
			n = spreadNames(postgres.Names(), agentQueue, driftInterval)
		} else {
			n = spreadStoreObjects(agentInformer.Informer().GetStore(), agentQueue, driftInterval)
		}
		slog.DebugContext(ctx, "drift sweep enqueued agents", "count", n, "over", driftInterval)
	})
	go every(ctx, 30*time.Second, func() {
		parked := agentReconciler.ParkedForRetry()
		for _, name := range parked {
			agentQueue.Add(name)
		}
		if len(parked) > 0 {
			slog.DebugContext(ctx, "parked-retry re-enqueued agents", "count", len(parked))
		}
	})

	go every(ctx, 30*time.Second, func() {
		if err := agentReconciler.StoreHealthy(); err != nil {
			slog.DebugContext(ctx, "memory and pool passes skipped: the Agent store is not answering", "error", err)
			return
		}
		for _, name := range agentReconciler.MemoryPass(ctx) {
			agentQueue.Add(name)
		}
		for _, name := range agentReconciler.PoolPass(ctx) {
			agentQueue.Add(name)
		}
	})

	agentQueue.run(ctx, agentReconciler, agentLister)
}

const maxReconcileRetries = 15

type agentReconcile interface {
	Reconcile(ctx context.Context, agent *apiv1.Agent) error
	SetBackoffExceeded(ctx context.Context, name string, attempts int, cause error)
}

func runAgentWorker(ctx context.Context, r agentReconcile, agents cache.GenericNamespaceLister, queue agentQueue) {
	for {
		name, shutdown := queue.Get()
		if shutdown {
			return
		}
		urgent := queue.lanes.poppedUrgent()
		slog.DebugContext(ctx, "agent reconcile dequeued", "name", name, "queueDepth", queue.Len())
		func() {
			defer queue.Done(name)
			rctx, finish := telemetry.StartReconcile(ctx, "agent", name)
			obj, err := agents.Get(name)
			var agent *apiv1.Agent
			if err == nil {
				agent, err = reconciler.FromCacheObject[apiv1.Agent](obj)
			}
			if err != nil {
				queue.Forget(name)
				finish(telemetry.OutcomeNotFound, nil)
				return
			}
			if err := r.Reconcile(rctx, agent); err != nil {
				if urgent {
					queue.lanes.promote(name)
				}
				queue.AddRateLimited(name)
				requeues := queue.NumRequeues(name)
				telemetry.SetRequeues(rctx, requeues)
				if requeues >= maxReconcileRetries {
					r.SetBackoffExceeded(rctx, name, requeues, err)
					slog.ErrorContext(rctx, "reconcile agent: backoff limit exceeded",
						"name", name, "requeues", requeues, "error", err)
					finish(telemetry.OutcomeBackoffExceeded, err)
					return
				}
				slog.ErrorContext(rctx, "reconcile agent; requeued",
					"name", name, "requeues", requeues, "error", err)
				finish(telemetry.OutcomeError, err)
				return
			}
			queue.Forget(name)
			finish(telemetry.OutcomeSuccess, nil)
		}()
	}
}

// UNIT_BOUNDARY_DESCRIPTION: how many workers reconcile agents. A reconcile can wait on its owner's VM runner for the runner client's whole timeout, under the owner's lock, and one worker for the install put every other owner's wake behind that wait. The workers share nothing a reconcile waits on but the Kubernetes client's rate limiter, so more of them only lower the share of owners one hung runner holds up, while queueing more calls for the same tokens.
const agentWorkers = 8

// UNIT_BOUNDARY_DESCRIPTION: the agent work queues, one per worker. An agent's owner label picks its queue, so every agent of one owner is reconciled by one worker, one at a time: the budget's read-decide-scale and the runner calls of two agents of one owner never interleave, while a runner that hangs holds up only the owners that share its worker. A name the agent cache does not hold is dropped rather than guessed at, because a guess could put one agent on two workers at once; the reconcile would only have found it missing, and the informer's add for it queues it when it lands. An Agent's owner label is set when it is created and never changes, so its queue never changes either.
type shardedAgentQueue struct {
	shards []agentQueue
	agents cache.GenericNamespaceLister
}

func newShardedAgentQueue(agents cache.GenericNamespaceLister) shardedAgentQueue {
	q := shardedAgentQueue{shards: make([]agentQueue, agentWorkers), agents: agents}
	for i := range q.shards {
		q.shards[i] = newAgentQueue(fmt.Sprintf("agent-%d", i))
	}
	return q
}

func (q shardedAgentQueue) shard(name string) (agentQueue, bool) {
	obj, err := q.agents.Get(name)
	if err != nil {
		return agentQueue{}, false
	}
	m, err := meta.Accessor(obj)
	if err != nil {
		return agentQueue{}, false
	}
	h := fnv.New32a()
	h.Write([]byte(reconciler.AgentOwner(m.GetLabels())))
	return q.shards[h.Sum32()%uint32(len(q.shards))], true
}

func (q shardedAgentQueue) Add(name string) {
	if s, ok := q.shard(name); ok {
		s.Add(name)
	}
}

func (q shardedAgentQueue) AddAfter(name string, after time.Duration) {
	if s, ok := q.shard(name); ok {
		s.AddAfter(name, after)
	}
}

func (q shardedAgentQueue) AddUrgent(name string) {
	if s, ok := q.shard(name); ok {
		s.AddUrgent(name)
	}
}

func (q shardedAgentQueue) add(background bool, name string) {
	if s, ok := q.shard(name); ok {
		s.add(background, name)
	}
}

func (q shardedAgentQueue) ShutDown() {
	for _, s := range q.shards {
		s.ShutDown()
	}
}

func (q shardedAgentQueue) run(ctx context.Context, r agentReconcile, agents cache.GenericNamespaceLister) {
	var wg sync.WaitGroup
	for _, s := range q.shards {
		wg.Go(func() { runAgentWorker(ctx, r, agents, s) })
	}
	wg.Wait()
}

// UNIT_BOUNDARY_DESCRIPTION: one worker's agent queue, in two lanes. A change a person is waiting on — a wake bumping last-activity, a new Agent, a spec or annotation edit, a pod or machine moving — goes in the urgent lane; the startup list, the drift sweep, the retry and memory ticks and the controller's own status echoes go in the background lane. The worker always takes the urgent lane first, so a wake waits behind at most the one reconcile its worker is already running, not behind the fleet a restart enqueues. It is still a client-go queue with its dedupe, rate limiting and metrics: only the order of the items waiting changes.
type agentQueue struct {
	workqueue.TypedRateLimitingInterface[string]
	lanes *agentLanes
}

func newAgentQueue(name string) agentQueue {
	lanes := &agentLanes{promoted: sets.New[string]()}
	base := workqueue.NewTypedWithConfig(workqueue.TypedQueueConfig[string]{Name: name, Queue: lanes})
	delaying := workqueue.NewTypedDelayingQueueWithConfig(workqueue.TypedDelayingQueueConfig[string]{Name: name, Queue: base})
	return agentQueue{
		TypedRateLimitingInterface: workqueue.NewTypedRateLimitingQueueWithConfig(workqueue.DefaultTypedControllerRateLimiter[string](),
			workqueue.TypedRateLimitingQueueConfig[string]{Name: name, DelayingQueue: delaying}),
		lanes: lanes,
	}
}

func (q agentQueue) AddUrgent(name string) {
	q.lanes.promote(name)
	q.Add(name)
}

func (q agentQueue) add(background bool, name string) {
	switch {
	case name == "":
	case background:
		q.Add(name)
	default:
		q.AddUrgent(name)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the storage under the agent queue. The queue calls it under its own lock, but a promotion comes from informer and watch goroutines, so it has a lock of its own. A promotion waits until the queue pushes or touches the name: an agent already waiting moves to the urgent lane, and one being reconciled goes there when the queue pushes it again after Done. Removing a name from the background lane is a linear scan, which a few hundred agents do not feel.
type agentLanes struct {
	mu                 sync.Mutex
	urgent, background []string
	promoted           sets.Set[string]
	lastPopUrgent      bool
}

func (l *agentLanes) promote(name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.promoted.Insert(name)
}

func (l *agentLanes) poppedUrgent() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.lastPopUrgent
}

func (l *agentLanes) Touch(name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.promoted.Has(name) {
		return
	}
	l.promoted.Delete(name)
	if i := slices.Index(l.background, name); i >= 0 {
		l.background = slices.Delete(l.background, i, i+1)
		l.urgent = append(l.urgent, name)
	}
}

func (l *agentLanes) Push(name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.promoted.Has(name) {
		l.promoted.Delete(name)
		l.urgent = append(l.urgent, name)
		return
	}
	l.background = append(l.background, name)
}

func (l *agentLanes) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.urgent) + len(l.background)
}

func (l *agentLanes) Pop() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	lane := &l.background
	l.lastPopUrgent = len(l.urgent) > 0
	if l.lastPopUrgent {
		lane = &l.urgent
	}
	name := (*lane)[0]
	*lane = (*lane)[1:]
	return name
}

func specOrAnnotationsChanged(oldAgent, newAgent *unstructured.Unstructured) bool {
	return oldAgent == nil || oldAgent.GetGeneration() != newAgent.GetGeneration() ||
		!maps.Equal(oldAgent.GetAnnotations(), newAgent.GetAnnotations())
}

type deletedAgent struct {
	name, owner string
	uid         types.UID
}

// UNIT_BOUNDARY_DESCRIPTION: how many times a deleted Agent's cleanup is retried. The backoff doubles from a second to five minutes, so this is about three quarters of an hour; past it the orphan sweep, which finds machines no Agent claims, collects what is left. A cleanup is that old when it runs, so it reads the Agent live first: the name may belong to an Agent created again since, and its machine and home must stay.
const maxDeleteRetries = 12

// UNIT_BOUNDARY_DESCRIPTION: cleans up deleted Agents off the informer's goroutine. Removing a vm agent's machine is a call to its owner's runner, and a runner that is restarting would otherwise hold up every other event the informer delivers.
func runDeleteWorker(ctx context.Context, r *reconciler.AgentReconciler, queue workqueue.TypedRateLimitingInterface[deletedAgent]) {
	for {
		item, shutdown := queue.Get()
		if shutdown {
			return
		}
		func() {
			defer queue.Done(item)
			err := r.Delete(ctx, item.name, item.owner, item.uid)
			if err == nil {
				queue.Forget(item)
				return
			}
			if queue.NumRequeues(item) >= maxDeleteRetries {
				slog.ErrorContext(ctx, "deleted agent cleanup: giving up, the orphan sweep collects the rest", "agent", item.name, "owner", item.owner, "uid", item.uid, "error", err)
				queue.Forget(item)
				return
			}
			slog.WarnContext(ctx, "deleted agent cleanup failed; retrying", "agent", item.name, "owner", item.owner, "uid", item.uid, "error", err)
			queue.AddRateLimited(item)
		}()
	}
}

func resourceVersionChanged(oldObj, newObj interface{}) bool {
	oldMeta, err := meta.Accessor(oldObj)
	if err != nil {
		return true
	}
	newMeta, err := meta.Accessor(newObj)
	if err != nil {
		return true
	}
	return oldMeta.GetResourceVersion() != newMeta.GetResourceVersion()
}

// UNIT_BOUNDARY_DESCRIPTION: the sweep re-checks every agent there is, and handing them to the workers at once is what makes an agent someone is waiting for queue behind the whole fleet — measured at forty seconds of a saturated worker on an eighty-agent install, and it grows with the fleet. Spread across the interval instead, each agent is re-checked exactly as often as before and the queue is never more than a reconcile or two deep, so a create arriving mid-sweep is answered rather than parked. The cost is that an agent's first check after startup can land up to one interval later than it used to; nothing waits on a drift check, and a real change arrives through the informer rather than through this.
func spreadStoreObjects(store cache.Store, queue interface{ AddAfter(string, time.Duration) }, over time.Duration) int {
	items := store.List()
	for i, obj := range items {
		u := unstructuredFrom(obj)
		if u == nil {
			continue
		}
		queue.AddAfter(u.GetName(), time.Duration(i)*over/time.Duration(len(items)))
	}
	return len(items)
}

// UNIT_BOUNDARY_DESCRIPTION: waitForStore holds the controller's work until the first list has answered:
// UNIT_BOUNDARY_DESCRIPTION: an empty cache is not an empty fleet, and acting on it would tear down every
// UNIT_BOUNDARY_DESCRIPTION: gateway.
func waitForStore(ctx context.Context, s *store.Store) {
	t := time.NewTicker(100 * time.Millisecond)
	defer t.Stop()
	for !s.Synced() {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the drift pass hands every agent to the workers a little at a time, so a create arriving mid-pass is answered rather than queued behind the fleet. The store's own relist is what notices a change; this pass is the periodic re-check the controller has always done.
func spreadNames(names []string, queue interface{ AddAfter(string, time.Duration) }, over time.Duration) int {
	if len(names) == 0 {
		return 0
	}
	for i, name := range names {
		queue.AddAfter(name, time.Duration(i)*over/time.Duration(len(names)))
	}
	return len(names)
}

func every(ctx context.Context, interval time.Duration, fn func()) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			fn()
		}
	}
}

func unstructuredFrom(obj interface{}) *unstructured.Unstructured {
	if u, ok := obj.(*unstructured.Unstructured); ok {
		return u
	}
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		if u, ok := tombstone.Obj.(*unstructured.Unstructured); ok {
			return u
		}
	}
	return nil
}
