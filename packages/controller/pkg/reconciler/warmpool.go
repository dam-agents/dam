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
)

// defaultReplenishInterval is used when controller.warmPool.replenishInterval
// is unset (zero).
const defaultReplenishInterval = 30 * time.Second

// defaultMaxProvisioningTime is used when controller.warmPool.maxProvisioningTime
// is unset (zero). Deliberately generous: it must sit above the worst-case
// *healthy* provisioning time on any RWX backend, or a slow-but-healthy spare
// would be reclaimed and recreated in a churn loop.
const defaultMaxProvisioningTime = 30 * time.Minute

// WarmPoolManager maintains a background buffer of pre-provisioned, already-Bound
// spare workspace PVCs (#692). Leader-only single goroutine (mirrors IdleChecker).
// It only creates/GCs *available* spares; the reconciler only *claims* them — so
// the two writers never contend over the same PVC.
type WarmPoolManager struct {
	client kubernetes.Interface
	config *config.Config
	now    func() time.Time // overridable in tests for deterministic staleness
}

func NewWarmPoolManager(client kubernetes.Interface, cfg *config.Config) *WarmPoolManager {
	return &WarmPoolManager{client: client, config: cfg, now: time.Now}
}

// RunLoop reconciles every configured size pool to its target on a ticker and
// blocks until ctx is cancelled. It is a no-op (returns immediately) when the
// warm pool is disabled, so a default deployment incurs zero work.
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
	m.reconcile(ctx) // fill immediately, like the orphan sweep
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

// maxPendingAge bounds how long a spare may sit Pending (provisioning) before
// we treat it as stuck (wrong/over-quota StorageClass) and reclaim it, so a few
// stuck spares can't permanently starve the pool's refill budget. Operator-set
// (controller.warmPool.maxProvisioningTime); the default is generous so a
// healthy-but-slow provision is never reaped.
func (m *WarmPoolManager) maxPendingAge() time.Duration {
	if d := m.config.WarmPool.MaxProvisioningTime.AsDuration(); d > 0 {
		return d
	}
	return defaultMaxProvisioningTime
}

// reconcile brings every configured size pool to target and reaps spares whose
// size is no longer configured. Each step logs and continues on error; the next
// tick retries.
func (m *WarmPoolManager) reconcile(ctx context.Context) {
	configured := make(map[string]bool, len(m.config.WarmPool.Sizes))
	for _, s := range m.config.WarmPool.Sizes {
		key, err := canonicalSize(s.Size)
		if err != nil {
			// Validated at startup, so this is unreachable in practice.
			slog.Error("warm pool: skipping unparseable size", "size", s.Size, "error", err)
			continue
		}
		configured[key] = true
		m.reconcileSize(ctx, key, s.Target)
	}
	m.gcRemovedPools(ctx, configured)
}

// reconcileSize drives one size pool to target: reap stuck/lost spares, create
// enough to cover the shortfall (counting in-flight Pending spares so we don't
// over-provision while provisioning is slow), and trim Bound excess oldest-first.
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
		switch p.Status.Phase {
		case corev1.ClaimBound:
			bound = append(bound, p)
		case corev1.ClaimLost:
			stale = append(stale, p) // bound PV vanished — never usable
		default: // Pending or "" (just created) — provisioning in flight
			if now.Sub(p.CreationTimestamp.Time) > maxAge {
				stale = append(stale, p) // stuck (wrong/over-quota class)
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

	// Count Bound + still-provisioning toward the target so a slow provisioner
	// doesn't make us create a fresh batch every tick.
	have := len(bound) + len(pending)
	for i := have; i < target; i++ {
		pvc := buildPoolPVC(m.config, poolKey)
		if _, err := m.client.CoreV1().PersistentVolumeClaims(m.config.Namespace).Create(ctx, pvc, metav1.CreateOptions{}); err != nil {
			slog.Warn("warm pool: creating spare failed", "pool", poolKey, "error", err)
			continue
		}
		slog.Info("warm pool: provisioned spare", "pool", poolKey, "pvc", pvc.Name)
	}

	// Shrink to target, oldest first. target is a setpoint, not a floor: lowering
	// it (or setting 0) must release the surplus *provisioned* storage, or a
	// scaled-down pool would keep paying for idle Bound volumes forever.
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

// gcRemovedPools deletes available spares whose size is no longer configured
// (an operator removed that size entry entirely). Only ever touches available
// spares — a claimed PVC has lost its available marker and belongs to an agent.
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

// listAvailable returns the unclaimed spares for a pool key.
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

// warnIfNotImmediate logs a loud warning if the configured pool StorageClass
// binds WaitForFirstConsumer — under which spares never pre-provision, defeating
// the pool. Best-effort: a read error (e.g. missing RBAC) is logged and ignored.
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

// buildPoolPVC renders an unclaimed spare for poolKey. It carries no
// OwnerReference (it outlives any single agent and must survive the orphan
// sweep) and no agent label (so the orphan sweep, which lists by LabelAgent,
// never sees it). poolKey is a canonical quantity string, so it doubles as the
// storage request and the pool-key label.
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
			// A claimed spare becomes the agent's workspace PVC, so its access
			// mode must match live agents' — inherit the single AgentBase value
			// rather than a pool-specific knob that could drift (must be RWX so
			// forks co-mount; ADR-027).
			AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.PersistentVolumeAccessMode(cfg.AgentBase.AccessMode)},
			StorageClassName: &sc,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(poolKey)},
			},
		},
	}
}

// canonicalSize normalizes a size string to its canonical quantity form so that
// equivalent spellings collide into one pool (e.g. "5Gi" and "5120Mi"). The
// canonical form is also used as the LabelPool value, so it must be a valid
// label value — enforced at config validation.
func canonicalSize(size string) (string, error) {
	q, err := resource.ParseQuantity(size)
	if err != nil {
		return "", err
	}
	return q.String(), nil
}

// poolTargets maps each configured pool's canonical size to its target count.
func poolTargets(wp config.WarmPool) map[string]int {
	out := make(map[string]int, len(wp.Sizes))
	for _, s := range wp.Sizes {
		if c, err := canonicalSize(s.Size); err == nil {
			out[c] = s.Target
		}
	}
	return out
}

// matchPoolKey returns the canonical pool key for a mount's effective size if a
// pool is configured for it, else ok=false (the mount falls back to dynamic
// provisioning).
func matchPoolKey(targets map[string]int, size string) (string, bool) {
	c, err := canonicalSize(size)
	if err != nil {
		return "", false
	}
	_, ok := targets[c]
	return c, ok
}
