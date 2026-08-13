package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	utilrand "k8s.io/apimachinery/pkg/util/rand"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/telemetry"
)

const defaultReplenishInterval = 30 * time.Second

const defaultMaxProvisioningTime = 30 * time.Minute

type WarmPoolManager struct {
	client kubernetes.Interface
	config *config.Config
	now    func() time.Time
}

func NewWarmPoolManager(client kubernetes.Interface, cfg *config.Config) *WarmPoolManager {
	return &WarmPoolManager{client: client, config: cfg, now: time.Now}
}

func (m *WarmPoolManager) RunLoop(ctx context.Context) {
	if !m.config.WarmPool.Enabled {
		slog.Info("warm pool disabled")
		return
	}
	interval := m.replenishInterval()
	m.warnIfNotImmediate(ctx)
	slog.Info("warm pool manager started", "interval", interval, "pools", len(m.config.WarmPool.Sizes))
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	m.reconcile(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.reconcile(ctx)
		}
	}
}

func (m *WarmPoolManager) replenishInterval() time.Duration {
	if d := m.config.WarmPool.ReplenishInterval.AsDuration(); d > 0 {
		return d
	}
	return defaultReplenishInterval
}

func (m *WarmPoolManager) maxPendingAge() time.Duration {
	if d := m.config.WarmPool.MaxProvisioningTime.AsDuration(); d > 0 {
		return d
	}
	return defaultMaxProvisioningTime
}

func (m *WarmPoolManager) reconcile(ctx context.Context) {
	ctx, finish := telemetry.StartPass(ctx, "warm pool sweep")
	defer finish(nil)
	start := time.Now()
	configured := make(map[string]bool, len(m.config.WarmPool.Sizes))
	for _, s := range m.config.WarmPool.Sizes {
		key, err := canonicalSize(s.Size)
		if err != nil {
			slog.Error("warm pool: skipping unparseable size", "size", s.Size, "error", err)
			continue
		}
		configured[key] = true
		m.reconcileSize(ctx, key, s.Target)
	}
	m.gcRemovedPools(ctx, configured)
	slog.Debug("warm pool sweep complete", "pools", len(configured), "duration", time.Since(start))
}

func (m *WarmPoolManager) reconcileSize(ctx context.Context, poolKey string, target int) {
	avail, err := m.listAvailable(ctx, poolKey)
	if err != nil {
		slog.Warn("warm pool: listing spares failed", "pool", poolKey, "error", err)
		return
	}

	now := m.now()
	maxAge := m.maxPendingAge()
	var bound, pending, stale []corev1.PersistentVolumeClaim
	for _, p := range avail {
		if isRWX(p.Spec.AccessModes) {
			stale = append(stale, p)
			continue
		}
		switch p.Status.Phase {
		case corev1.ClaimBound:
			bound = append(bound, p)
		case corev1.ClaimLost:
			stale = append(stale, p)
		default:
			if now.Sub(p.CreationTimestamp.Time) > maxAge {
				stale = append(stale, p)
			} else {
				pending = append(pending, p)
			}
		}
	}

	for _, p := range stale {
		if m.deletePVC(ctx, p.Name) == nil {
			slog.Info("warm pool: reclaimed stuck/lost spare", "pool", poolKey, "pvc", p.Name, "phase", p.Status.Phase)
		}
	}

	have := len(bound) + len(pending)
	for i := have; i < target; i++ {
		pvc := buildPoolPVC(m.config, poolKey)
		if _, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Create(ctx, pvc, metav1.CreateOptions{}); err != nil {
			slog.Warn("warm pool: creating spare failed", "pool", poolKey, "error", err)
			continue
		}
		slog.Info("warm pool: provisioned spare", "pool", poolKey, "pvc", pvc.Name)
	}

	if len(bound) > target {
		sort.Slice(bound, func(i, j int) bool {
			return bound[i].CreationTimestamp.Time.Before(bound[j].CreationTimestamp.Time)
		})
		for _, p := range bound[:len(bound)-target] {
			if m.deletePVC(ctx, p.Name) == nil {
				slog.Info("warm pool: trimmed excess spare", "pool", poolKey, "pvc", p.Name)
			}
		}
	}
}

func (m *WarmPoolManager) gcRemovedPools(ctx context.Context, configured map[string]bool) {
	all, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelPoolAvailable + "=true",
	})
	if err != nil {
		slog.Warn("warm pool: listing spares for removed-pool GC failed", "error", err)
		return
	}
	for _, p := range all.Items {
		key := p.Labels[LabelPool]
		if key == "" || configured[key] {
			continue
		}
		if m.deletePVC(ctx, p.Name) == nil {
			slog.Info("warm pool: reclaimed spare for removed pool", "pool", key, "pvc", p.Name)
		}
	}
}

func (m *WarmPoolManager) listAvailable(ctx context.Context, poolKey string) ([]corev1.PersistentVolumeClaim, error) {
	list, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelPool + "=" + poolKey + "," + LabelPoolAvailable + "=true",
	})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func (m *WarmPoolManager) deletePVC(ctx context.Context, name string) error {
	err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		slog.Warn("warm pool: deleting spare failed", "pvc", name, "error", err)
	}
	return err
}

func (m *WarmPoolManager) warnIfNotImmediate(ctx context.Context) {
	sc, err := m.client.StorageV1().StorageClasses().Get(ctx, m.config.WarmPool.StorageClass, metav1.GetOptions{})
	if err != nil {
		slog.Warn("warm pool: could not verify StorageClass binding mode", "storageClass", m.config.WarmPool.StorageClass, "error", err)
		return
	}
	if sc.VolumeBindingMode != nil && *sc.VolumeBindingMode == storagev1.VolumeBindingWaitForFirstConsumer {
		slog.Warn("warm pool: StorageClass uses WaitForFirstConsumer binding — spares will sit Pending until mounted and the pool will NOT pre-warm; use an Immediate-binding class",
			"storageClass", m.config.WarmPool.StorageClass)
	}
}

func buildPoolPVC(cfg *config.Config, poolKey string) *corev1.PersistentVolumeClaim {
	sc := cfg.WarmPool.StorageClass
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-pool-%s", cfg.ReleaseName, utilrand.String(6)),
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelPool:          poolKey,
				LabelPoolAvailable: "true",
			},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			StorageClassName: &sc,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(poolKey)},
			},
		},
	}
}

func canonicalSize(size string) (string, error) {
	q, err := resource.ParseQuantity(size)
	if err != nil {
		return "", err
	}
	return q.String(), nil
}

func poolTargets(wp config.WarmPool) map[string]int {
	out := make(map[string]int, len(wp.Sizes))
	for _, s := range wp.Sizes {
		if c, err := canonicalSize(s.Size); err == nil {
			out[c] = s.Target
		}
	}
	return out
}

func matchPoolKey(targets map[string]int, size string) (string, bool) {
	c, err := canonicalSize(size)
	if err != nil {
		return "", false
	}
	_, ok := targets[c]
	return c, ok
}
