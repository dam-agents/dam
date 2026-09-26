package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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

	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/crdcheck"
	"github.com/dam-agents/dam/packages/controller/pkg/reconciler"
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

	// UNIT_BOUNDARY_DESCRIPTION: a reconcile spends almost all of its time waiting for this limiter rather than for the API server. Measured on a 80-agent install: each reconcile issues around thirty calls, every one of them answered in single-digit milliseconds and then followed by a wait until the next token — twenty milliseconds apart at fifty a second, which is where a 700 ms reconcile goes. The drift sweep hands the queue every agent at once, so the fleet costs thirty calls times its size, and an agent created during that window waits behind all of it. Raising the ceiling is what shortens that wait: a second worker would only queue for the same tokens, since the limiter is shared and the API server was never the thing saying no.
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
	slog.Info("started leading", "namespace", cfg.Namespace)

	dynFactory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(dynClient, 30*time.Second, cfg.Namespace, nil)
	agentInformer := dynFactory.ForResource(reconciler.AgentsGVR)

	podFactory := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = reconciler.LabelAgent
		}),
	)
	podInformer := podFactory.Core().V1().Pods()

	agentGetter := reconciler.NewAgentLister(agentInformer.Lister(), cfg.Namespace)
	agentReconciler := reconciler.NewAgentReconciler(client, cfg).WithDynamicClient(dynClient).WithAgentCache(agentInformer.Lister())

	idleChecker := reconciler.NewIdleChecker(client, dynClient, cfg)
	if cfg.VM.Enabled {
		idleChecker.WithMachineHalt(agentReconciler.HaltMachine)
		agentReconciler.CheckVMInstall(ctx)
		go runVMPreflight(ctx, agentReconciler, 5*time.Minute)
	}
	go idleChecker.RunLoop(ctx)

	warmPool := reconciler.NewWarmPoolManager(client, cfg)
	go warmPool.RunLoop(ctx)

	storageMigration := reconciler.NewStorageMigrationManager(client, dynClient, cfg)
	go storageMigration.RunLoop(ctx)

	go runOrphanSweep(ctx, agentReconciler, 10*time.Minute)

	agentQueue := workqueue.NewTypedRateLimitingQueueWithConfig(workqueue.DefaultTypedControllerRateLimiter[string](),
		workqueue.TypedRateLimitingQueueConfig[string]{Name: "agent"})
	defer agentQueue.ShutDown()
	agentReconciler.WithRequeue(ctx, agentQueue.AddAfter)

	agentInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) { enqueueObjectName(obj, agentQueue) },
		UpdateFunc: func(oldObj, newObj interface{}) {
			if !resourceVersionChanged(oldObj, newObj) {
				return
			}
			enqueueObjectName(newObj, agentQueue)
		},
		DeleteFunc: func(obj interface{}) {
			if u := unstructuredFrom(obj); u != nil {
				agentReconciler.Delete(ctx, u.GetName(), u.GetLabels())
			}
		},
	})

	podInformer.TypedInformer().AddTypedEventHandler(coreinformers.PodHandlerFuncs{
		AddFunc: func(pod *corev1.Pod) { enqueuePodOwner(pod, agentQueue) },
		UpdateFunc: func(oldPod, newPod *corev1.Pod) {
			if oldPod.ResourceVersion == newPod.ResourceVersion {
				return
			}
			enqueuePodOwner(newPod, agentQueue)
		},
		DeleteFunc: func(deleted coreinformers.DeletedPod) {
			if deleted.OptionalObj != nil {
				enqueuePodOwner(deleted.OptionalObj, agentQueue)
			}
		},
	})

	dynFactory.Start(ctx.Done())
	podFactory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), agentInformer.Informer().HasSynced, podInformer.Informer().HasSynced) {
		slog.Error("failed to sync informer caches")
		return
	}
	slog.Info("informer caches synced")

	go runDriftSweep(ctx, agentInformer.Informer().GetStore(), agentQueue, 5*time.Minute)
	go runParkedRetry(ctx, agentReconciler, agentQueue, 30*time.Second)

	runAgentWorker(ctx, agentReconciler, agentGetter, agentQueue)
}

const maxReconcileRetries = 15

func runAgentWorker(ctx context.Context, r *reconciler.AgentReconciler, getter reconciler.AgentGetter, queue workqueue.TypedRateLimitingInterface[string]) {
	for {
		name, shutdown := queue.Get()
		if shutdown {
			return
		}
		slog.DebugContext(ctx, "agent reconcile dequeued", "name", name, "queueDepth", queue.Len())
		func() {
			defer queue.Done(name)
			rctx, finish := telemetry.StartReconcile(ctx, "agent", name)
			agent, err := getter.Get(name)
			if err != nil {
				queue.Forget(name)
				finish(telemetry.OutcomeNotFound, nil)
				return
			}
			if err := r.Reconcile(rctx, agent); err != nil {
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

func enqueueObjectName(obj interface{}, queue workqueue.TypedRateLimitingInterface[string]) {
	if u := unstructuredFrom(obj); u != nil {
		queue.Add(u.GetName())
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

// UNIT_BOUNDARY_DESCRIPTION: the sweep re-checks every agent there is, and handing them to the single worker at once is what makes an agent someone is waiting for queue behind the whole fleet — measured at forty seconds of a saturated worker on an eighty-agent install, and it grows with the fleet. Spread across the interval instead, each agent is re-checked exactly as often as before and the queue is never more than a reconcile or two deep, so a create arriving mid-sweep is answered rather than parked. The cost is that an agent's first check after startup can land up to one interval later than it used to; nothing waits on a drift check, and a real change arrives through the informer rather than through this.
func spreadStoreObjects(store cache.Store, queue workqueue.TypedRateLimitingInterface[string], over time.Duration) int {
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

func runParkedRetry(ctx context.Context, r *reconciler.AgentReconciler, queue workqueue.TypedRateLimitingInterface[string], interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			parked := r.ParkedForRetry()
			for _, name := range parked {
				queue.Add(name)
			}
			if len(parked) > 0 {
				slog.DebugContext(ctx, "parked-retry re-enqueued agents", "count", len(parked))
			}
		}
	}
}

func runDriftSweep(ctx context.Context, store cache.Store, queue workqueue.TypedRateLimitingInterface[string], interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n := spreadStoreObjects(store, queue, interval)
			slog.DebugContext(ctx, "drift sweep enqueued agents", "count", n, "over", interval)
		}
	}
}

func enqueuePodOwner(pod *corev1.Pod, queue workqueue.TypedRateLimitingInterface[string]) {
	if name := pod.Labels[reconciler.LabelAgent]; name != "" {
		queue.Add(name)
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

func runVMPreflight(ctx context.Context, r *reconciler.AgentReconciler, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.CheckVMInstall(ctx)
		}
	}
}

func runOrphanSweep(ctx context.Context, r *reconciler.AgentReconciler, interval time.Duration) {
	sweep := func() {
		sctx, finish := telemetry.StartPass(ctx, "orphan sweep")
		start := time.Now()
		r.ReconcileOrphanPVCs(sctx)
		r.ReconcileOrphanLeafSecrets(sctx)
		r.ReconcileOrphanMachines(sctx)
		r.ReconcileRunnerRollout(sctx)
		slog.DebugContext(sctx, "orphan sweep complete", "duration", time.Since(start))
		finish(nil)
	}
	sweep()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweep()
		}
	}
}
