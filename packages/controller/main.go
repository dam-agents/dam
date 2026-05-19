package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	// Embed the IANA tzdata database in the binary so time.LoadLocation works
	// for arbitrary zones (e.g. "Europe/Prague") inside the minimal container
	// image, which doesn't ship /usr/share/zoneinfo. Schedules set their own
	// timezone, so UTC-only wouldn't be enough.
	_ "time/tzdata"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/leaderelection"
	"k8s.io/client-go/tools/leaderelection/resourcelock"
	"k8s.io/client-go/util/workqueue"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/reconciler"
	"github.com/kagenti/platform/packages/controller/pkg/scheduler"
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
				run(ctx, client, dynClient, restCfg, cfg)
			},
			OnStoppedLeading: func() {
				slog.Info("lost leadership")
			},
		},
	})
}

func run(ctx context.Context, client kubernetes.Interface, dynClient dynamic.Interface, restCfg *rest.Config, cfg *config.Config) {
	slog.Info("started leading", "namespace", cfg.Namespace)

	factory := informers.NewSharedInformerFactoryWithOptions(client, 30*time.Second,
		informers.WithNamespace(cfg.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = "agent-platform.ai/type"
		}),
	)

	cmInformer := factory.Core().V1().ConfigMaps()
	agentResolver := reconciler.NewAgentResolver(cmInformer.Lister().ConfigMaps(cfg.Namespace))
	agentReconciler := reconciler.NewAgentReconciler(client, cfg).WithDynamicClient(dynClient)
	forkReconciler := reconciler.NewForkReconciler(client, cfg, agentResolver).WithDynamicClient(dynClient)

	sched := scheduler.New(client, cfg).WithRESTConfig(restCfg)
	sched.Start()
	defer sched.Stop()

	idleChecker := reconciler.NewIdleChecker(client, cfg)
	go idleChecker.RunLoop(ctx)

	// Periodic GC for resources whose agent ConfigMap has been removed
	// out-of-band (issue #244). The Delete event handler covers the
	// happy path; this catches crashes mid-delete and direct kubectl removals.
	// Leaf TLS Secrets are also reaped here so historical leaks (from before
	// owner-references were added) are eventually cleaned up.
	go runOrphanSweep(ctx, agentReconciler, 10*time.Minute)

	queue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer queue.ShutDown()

	cmInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			cm := obj.(*corev1.ConfigMap)
			queue.Add(cm.Namespace + "/" + cm.Name)
		},
		UpdateFunc: func(_, newObj interface{}) {
			cm := newObj.(*corev1.ConfigMap)
			queue.Add(cm.Namespace + "/" + cm.Name)
		},
		DeleteFunc: func(obj interface{}) {
			cm, ok := obj.(*corev1.ConfigMap)
			if !ok {
				tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
				if !ok {
					return
				}
				cm, ok = tombstone.Obj.(*corev1.ConfigMap)
				if !ok {
					return
				}
			}
			cmType := cm.Labels["agent-platform.ai/type"]
			switch cmType {
			case "agent":
				agentReconciler.Delete(ctx, cm.Name)
			case "agent-schedule":
				sched.RemoveSchedule(cm.Name)
			case "agent-fork":
				forkReconciler.Delete(ctx, cm.Name)
			}
		},
	})

	factory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), cmInformer.Informer().HasSynced) {
		slog.Error("failed to sync informer caches")
		return
	}
	slog.Info("informer caches synced")

	for {
		key, shutdown := queue.Get()
		if shutdown {
			return
		}
		func() {
			defer queue.Done(key)

			name := keyName(key)
			cm, err := cmInformer.Lister().ConfigMaps(cfg.Namespace).Get(name)
			if err != nil {
				queue.Forget(key)
				return
			}

			cmType := cm.Labels["agent-platform.ai/type"]
			switch cmType {
			case "agent":
				if err := agentReconciler.Reconcile(ctx, cm); err != nil {
					slog.Error("reconcile agent", "name", name, "error", err)
					queue.AddRateLimited(key)
					return
				}
			case "agent-schedule":
				if err := sched.SyncSchedule(cm); err != nil {
					slog.Error("sync schedule", "name", name, "error", err)
					queue.AddRateLimited(key)
					return
				}
				slog.Info("synced schedule", "name", name)
			case "agent-fork":
				if err := forkReconciler.Reconcile(ctx, cm); err != nil {
					slog.Error("reconcile fork", "name", name, "error", err)
					queue.AddRateLimited(key)
					return
				}
			}
			queue.Forget(key)
		}()
	}
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

func keyName(key string) string {
	for i := len(key) - 1; i >= 0; i-- {
		if key[i] == '/' {
			return key[i+1:]
		}
	}
	return key
}
