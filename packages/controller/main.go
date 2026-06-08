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
	"github.com/kagenti/platform/packages/controller/pkg/reconciler"
)

func main() {
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

func run(ctx context.Context, client kubernetes.Interface, dynClient dynamic.Interface, cfg *config.Config) {
	slog.Info("started leading", "namespace", cfg.Namespace)

	// Agents and Forks are custom resources (ADR-058) — watched via dynamic
	// informers off a shared factory.
	dynFactory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(dynClient, 30*time.Second, cfg.Namespace, nil)
	agentInformer := dynFactory.ForResource(reconciler.AgentsGVR)
	forkInformer := dynFactory.ForResource(reconciler.ForksGVR)

	// Pod informer (ADR-059): pod readiness transitions re-enqueue the owning
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

	podInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { enqueuePodOwner(obj, agentQueue) },
		UpdateFunc: func(_, newObj interface{}) { enqueuePodOwner(newObj, agentQueue) },
		DeleteFunc: func(obj interface{}) { enqueuePodOwner(obj, agentQueue) },
	})

	dynFactory.Start(ctx.Done())
	podFactory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), agentInformer.Informer().HasSynced, forkInformer.Informer().HasSynced, podInformer.Informer().HasSynced) {
		slog.Error("failed to sync informer caches")
		return
	}
	slog.Info("informer caches synced")

	go runForkWorker(ctx, forkReconciler, forkInformer.Lister(), cfg.Namespace, forkQueue)
	runAgentWorker(ctx, agentReconciler, agentGetter, agentQueue)
}

// runAgentWorker drains the agent queue, reconciling each Agent CR resolved
// from the informer cache. Blocks until the queue shuts down.
func runAgentWorker(ctx context.Context, r *reconciler.AgentReconciler, getter reconciler.AgentGetter, queue workqueue.TypedRateLimitingInterface[string]) {
	for {
		name, shutdown := queue.Get()
		if shutdown {
			return
		}
		func() {
			defer queue.Done(name)
			agent, err := getter.Get(name)
			if err != nil {
				// Gone from cache (deleted) or undecodable — Delete handler
				// owns teardown; nothing to reconcile.
				queue.Forget(name)
				return
			}
			if err := r.Reconcile(ctx, agent); err != nil {
				slog.Error("reconcile agent", "name", name, "error", err)
				queue.AddRateLimited(name)
				return
			}
			queue.Forget(name)
		}()
	}
}

// runForkWorker drains the fork queue, reconciling each Fork CR read from the
// informer cache. Blocks until the queue shuts down.
func runForkWorker(ctx context.Context, r *reconciler.ForkReconciler, lister cache.GenericLister, namespace string, queue workqueue.TypedRateLimitingInterface[string]) {
	for {
		name, shutdown := queue.Get()
		if shutdown {
			return
		}
		func() {
			defer queue.Done(name)
			obj, err := lister.ByNamespace(namespace).Get(name)
			if err != nil {
				queue.Forget(name)
				return
			}
			fork, err := reconciler.ForkFromCacheObject(obj)
			if err != nil {
				slog.Error("decode fork", "name", name, "error", err)
				queue.Forget(name)
				return
			}
			if err := r.Reconcile(ctx, fork); err != nil {
				slog.Error("reconcile fork", "name", name, "error", err)
				queue.AddRateLimited(name)
				return
			}
			queue.Forget(name)
		}()
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
// the reconciler recomputes its Ready conditions (ADR-059). Fork pods carry
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
		r.ReconcileOrphanPVCs(ctx)
		r.ReconcileOrphanLeafSecrets(ctx)
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
