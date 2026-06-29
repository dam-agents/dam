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

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/crdcheck"
	"github.com/kagenti/platform/packages/controller/pkg/reconciler"
)

func main() {
	setupLogger()

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

	// Raise the client-go default (QPS 5 / Burst 10), shared across every
	// reconcile loop against this one client; the API server's priority &
	// fairness is the real backstop.
	if restCfg.QPS == 0 {
		restCfg.QPS = 50
		restCfg.Burst = 100
	}
	slog.Info("kube client rate limits", "qps", restCfg.QPS, "burst", restCfg.Burst)

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

	// Fail fast on every replica, before leader election — a stale CRD schema
	// would otherwise have this build's writes silently pruned.
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

// setupLogger installs the JSON slog handler at the LOG_LEVEL level (debug|info|
// warn|error, default info) — debug surfaces the per-reconcile phase timing.
// JSON on stderr keeps the controller ready for OTel zero-code instrumentation;
// keep it free of an in-process OTel TracerProvider, which would conflict with
// the Operator-injected eBPF auto-SDK.
func setupLogger() {
	level := slog.LevelInfo
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		if err := level.UnmarshalText([]byte(v)); err != nil {
			slog.Warn("invalid LOG_LEVEL; defaulting to info", "value", v, "error", err)
			level = slog.LevelInfo
		}
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})))
}

func run(ctx context.Context, client kubernetes.Interface, dynClient dynamic.Interface, cfg *config.Config) {
	slog.Info("started leading", "namespace", cfg.Namespace)

	// Agents, Forks, and Runs are custom resources — watched via dynamic
	// informers off a shared factory.
	dynFactory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(dynClient, 30*time.Second, cfg.Namespace, nil)
	agentInformer := dynFactory.ForResource(reconciler.AgentsGVR)
	forkInformer := dynFactory.ForResource(reconciler.ForksGVR)
	runInformer := dynFactory.ForResource(reconciler.RunsGVR)

	// Pod informer: pod readiness transitions re-enqueue the owning
	// agent so its Ready conditions are recomputed. Separate factory — it pins a
	// pod label selector the CR factory can't carry.
	podFactory := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = reconciler.LabelAgent
		}),
	)
	podInformer := podFactory.Core().V1().Pods()

	agentGetter := reconciler.NewAgentLister(agentInformer.Lister(), cfg.Namespace)
	agentResolver := reconciler.NewAgentResolver(agentGetter)
	agentReconciler := reconciler.NewAgentReconciler(client, cfg).WithDynamicClient(dynClient)
	forkReconciler := reconciler.NewForkReconciler(client, cfg, agentResolver).WithDynamicClient(dynClient)
	runReconciler := reconciler.NewRunReconciler(client, cfg, agentResolver).WithDynamicClient(dynClient)

	idleChecker := reconciler.NewIdleChecker(client, dynClient, cfg)
	go idleChecker.RunLoop(ctx)

	// Warm PVC pool (#692): pre-provisions spare workspace volumes so new
	// agents claim one instantly instead of waiting on dynamic provisioning.
	// Leader-only and a no-op when disabled.
	warmPool := reconciler.NewWarmPoolManager(client, cfg)
	go warmPool.RunLoop(ctx)

	// Periodic GC for resources whose Agent has been removed out-of-band
	// (issue #244). The Delete event handler covers the happy path; this
	// catches crashes mid-delete and direct kubectl removals. Leaf TLS
	// Secrets are also reaped here so historical leaks (from before
	// owner-references were added) are eventually cleaned up.
	go runOrphanSweep(ctx, agentReconciler, 10*time.Minute)

	agentQueue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer agentQueue.ShutDown()
	forkQueue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer forkQueue.ShutDown()
	runQueue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer runQueue.ShutDown()

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

	forkInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) { enqueueObjectName(obj, forkQueue) },
		UpdateFunc: func(_, newObj interface{}) {
			enqueueObjectName(newObj, forkQueue)
		},
		DeleteFunc: func(obj interface{}) {
			if u := unstructuredFrom(obj); u != nil {
				forkReconciler.Delete(ctx, u.GetName())
			}
		},
	})

	runInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) { enqueueObjectName(obj, runQueue) },
		UpdateFunc: func(_, newObj interface{}) {
			enqueueObjectName(newObj, runQueue)
		},
		DeleteFunc: func(obj interface{}) {
			if u := unstructuredFrom(obj); u != nil {
				runReconciler.Delete(ctx, u.GetName())
			}
		},
	})

	podInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			enqueuePodOwner(obj, agentQueue)
			enqueueRunPod(obj, runQueue)
		},
		UpdateFunc: func(_, newObj interface{}) {
			enqueuePodOwner(newObj, agentQueue)
			enqueueRunPod(newObj, runQueue)
		},
		DeleteFunc: func(obj interface{}) { enqueuePodOwner(obj, agentQueue) },
	})

	dynFactory.Start(ctx.Done())
	podFactory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), agentInformer.Informer().HasSynced, forkInformer.Informer().HasSynced, runInformer.Informer().HasSynced, podInformer.Informer().HasSynced) {
		slog.Error("failed to sync informer caches")
		return
	}
	slog.Info("informer caches synced")

	go runCachedWorker(ctx, "fork", forkInformer.Lister(), cfg.Namespace, forkQueue, reconciler.FromCacheObject[apiv1.Fork], forkReconciler.Reconcile)
	go runCachedWorker(ctx, "run", runInformer.Lister(), cfg.Namespace, runQueue, reconciler.FromCacheObject[apiv1.Run], runReconciler.Reconcile)
	runAgentWorker(ctx, agentReconciler, agentGetter, agentQueue)
}

// maxReconcileRetries is the consecutive-failure count after which an Agent is
// marked BackoffLimitExceeded (visibility only). The rate limiter already caps
// the retry delay (~1000s) and the resync keeps retrying, so recovery stays
// automatic — this just surfaces "stuck" on the condition.
const maxReconcileRetries = 15

// runAgentWorker drains the agent queue, reconciling each Agent CR resolved
// from the informer cache. Blocks until the queue shuts down.
func runAgentWorker(ctx context.Context, r *reconciler.AgentReconciler, getter reconciler.AgentGetter, queue workqueue.TypedRateLimitingInterface[string]) {
	for {
		name, shutdown := queue.Get()
		if shutdown {
			return
		}
		// queueDepth separates a slow reconcile from a backed-up queue.
		slog.Debug("agent reconcile dequeued", "name", name, "queueDepth", queue.Len())
		func() {
			defer queue.Done(name)
			agent, err := getter.Get(name)
			if err != nil {
				// Gone from cache (deleted) — Delete handler owns teardown.
				queue.Forget(name)
				return
			}
			if err := r.Reconcile(ctx, agent); err != nil {
				// Keep requeuing — the rate limiter caps the delay (~1000s) and
				// the resync still retries, so a transient cause recovers. Don't
				// Forget here: that resets the limiter to fast retries.
				queue.AddRateLimited(name)
				requeues := queue.NumRequeues(name)
				if requeues >= maxReconcileRetries {
					// Surface the persistent failure on the condition; retries
					// continue at the capped cadence. setError won't downgrade
					// this back, so the agent settles instead of flip-flopping.
					r.SetBackoffExceeded(ctx, name, requeues, err)
					slog.Error("reconcile agent: backoff limit exceeded",
						"name", name, "requeues", requeues, "error", err)
					return
				}
				slog.Error("reconcile agent; requeued",
					"name", name, "requeues", requeues, "error", err)
				return
			}
			queue.Forget(name)
		}()
	}
}

// runCachedWorker drains a queue, decoding each name from the informer cache
// and reconciling the typed CR. Shared by the Fork and Run workers (the Agent
// worker resolves via a getter, not a lister). Blocks until the queue shuts
// down. A missing object is forgotten (deleted out from under us); a decode or
// reconcile error is logged, with reconcile errors re-queued rate-limited.
func runCachedWorker[T any](ctx context.Context, kind string, lister cache.GenericLister, namespace string, queue workqueue.TypedRateLimitingInterface[string], decode func(any) (*T, error), reconcile func(context.Context, *T) error) {
	for {
		name, shutdown := queue.Get()
		if shutdown {
			return
		}
		slog.Debug(kind+" reconcile dequeued", "name", name, "queueDepth", queue.Len())
		func() {
			defer queue.Done(name)
			obj, err := lister.ByNamespace(namespace).Get(name)
			if err != nil {
				queue.Forget(name)
				return
			}
			typed, err := decode(obj)
			if err != nil {
				slog.Error("decode "+kind, "name", name, "error", err)
				queue.Forget(name)
				return
			}
			if err := reconcile(ctx, typed); err != nil {
				slog.Error("reconcile "+kind, "name", name, "error", err)
				queue.AddRateLimited(name)
				return
			}
			queue.Forget(name)
		}()
	}
}

// enqueueRunPod re-enqueues the owning Run when its executor pod transitions
// (e.g. becomes Ready), so the controller writes the Ready+podIP status without
// waiting for the informer resync — interactive dam-run startup stays snappy.
func enqueueRunPod(obj interface{}, queue workqueue.TypedRateLimitingInterface[string]) {
	pod, ok := obj.(*corev1.Pod)
	if !ok {
		return
	}
	if runID := pod.Labels[reconciler.RunLabelRunID]; runID != "" {
		queue.Add(runID)
	}
}

// enqueueObjectName adds an object's name to the queue, tolerating the
// unstructured shape the dynamic informer emits.
func enqueueObjectName(obj interface{}, queue workqueue.TypedRateLimitingInterface[string]) {
	if u := unstructuredFrom(obj); u != nil {
		queue.Add(u.GetName())
	}
}

// enqueuePodOwner re-enqueues the Agent that owns a pod (via the
// agent-platform.ai/agent label) when the pod's readiness may have changed, so
// the reconciler recomputes its Ready conditions. Fork pods carry
// the parent agent's label; re-reconciling the parent is harmless (idempotent).
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

// unstructuredFrom extracts the *unstructured.Unstructured from an informer
// event payload, unwrapping a delete tombstone if present.
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
		// Both passes list every PVC / Secret in the namespace; time them so a
		// heavy sweep eating the shared QPS budget shows up.
		start := time.Now()
		r.ReconcileOrphanPVCs(ctx)
		r.ReconcileOrphanLeafSecrets(ctx)
		slog.Debug("orphan sweep complete", "duration", time.Since(start))
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
