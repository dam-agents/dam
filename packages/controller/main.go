package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/leaderelection"
	"k8s.io/client-go/tools/leaderelection/resourcelock"
	"k8s.io/client-go/util/workqueue"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/crdcheck"
	"github.com/kagenti/platform/packages/controller/pkg/reconciler"
	"github.com/kagenti/platform/packages/controller/pkg/telemetry"
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

	if restCfg.QPS == 0 {
		restCfg.QPS = 50
		restCfg.Burst = 100
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
	agentReconciler := reconciler.NewAgentReconciler(client, cfg).WithDynamicClient(dynClient)

	idleChecker := reconciler.NewIdleChecker(client, dynClient, cfg)
	go idleChecker.RunLoop(ctx)

	warmPool := reconciler.NewWarmPoolManager(client, cfg)
	go warmPool.RunLoop(ctx)

	storageMigration := reconciler.NewStorageMigrationManager(client, dynClient, cfg)
	go storageMigration.RunLoop(ctx)

	go runOrphanSweep(ctx, agentReconciler, 10*time.Minute)

	agentQueue := workqueue.NewTypedRateLimitingQueueWithConfig(workqueue.DefaultTypedControllerRateLimiter[string](),
		workqueue.TypedRateLimitingQueueConfig[string]{Name: "agent"})
	defer agentQueue.ShutDown()

	agentInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) { enqueueObjectName(obj, agentQueue) },
		UpdateFunc: func(_, newObj interface{}) {
			enqueueObjectName(newObj, agentQueue)
		},
		DeleteFunc: func(obj interface{}) {
			if u := unstructuredFrom(obj); u != nil {
				agentReconciler.Delete(ctx, u.GetName())
			}
		},
	})

	podInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			enqueuePodOwner(obj, agentQueue)
		},
		UpdateFunc: func(_, newObj interface{}) {
			enqueuePodOwner(newObj, agentQueue)
		},
		DeleteFunc: func(obj interface{}) { enqueuePodOwner(obj, agentQueue) },
	})

	dynFactory.Start(ctx.Done())
	podFactory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), agentInformer.Informer().HasSynced, podInformer.Informer().HasSynced) {
		slog.Error("failed to sync informer caches")
		return
	}
	slog.Info("informer caches synced")

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

func enqueuePodOwner(obj interface{}, queue workqueue.TypedRateLimitingInterface[string]) {
	pod, ok := obj.(*corev1.Pod)
	if !ok {
		tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
		if !ok {
			return
		}
		if pod, ok = tombstone.Obj.(*corev1.Pod); !ok {
			return
		}
	}
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

func runOrphanSweep(ctx context.Context, r *reconciler.AgentReconciler, interval time.Duration) {
	sweep := func() {
		sctx, finish := telemetry.StartPass(ctx, "orphan sweep")
		start := time.Now()
		r.ReconcileOrphanPVCs(sctx)
		r.ReconcileOrphanLeafSecrets(sctx)
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
