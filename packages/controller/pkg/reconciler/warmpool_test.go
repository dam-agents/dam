package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func warmCfg(sizes ...config.WarmPoolSize) *config.Config {
	return &config.Config{
		Namespace:   "test-agents",
		ReleaseName: "platform",
		// The pool inherits the cluster workspace access mode from AgentBase.
		AgentBase: config.AgentBase{AccessMode: "ReadWriteMany"},
		WarmPool: config.WarmPool{
			Enabled:      true,
			StorageClass: "platform-rwx-immediate",
			Sizes:        sizes,
		},
	}
}

// availableSpare is an unclaimed pool PVC with the given phase + creation time.
func availableSpare(name, poolKey string, phase corev1.PersistentVolumeClaimPhase, created time.Time) *corev1.PersistentVolumeClaim {
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         "test-agents",
			CreationTimestamp: metav1.NewTime(created),
			Labels:            map[string]string{LabelPool: poolKey, LabelPoolAvailable: "true"},
		},
		Status: corev1.PersistentVolumeClaimStatus{Phase: phase},
	}
}

// claimedSpare is a pool PVC already claimed by an agent (no available marker).
func claimedSpare(name, poolKey, agent, mount string) *corev1.PersistentVolumeClaim {
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "test-agents",
			Labels:    map[string]string{LabelPool: poolKey, LabelAgent: agent, LabelMount: mount},
		},
		Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
	}
}

func availablePVCs(t *testing.T, client *fake.Clientset, poolKey string) []corev1.PersistentVolumeClaim {
	t.Helper()
	l, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(context.Background(), metav1.ListOptions{
		LabelSelector: LabelPool + "=" + poolKey + "," + LabelPoolAvailable + "=true",
	})
	require.NoError(t, err)
	return l.Items
}

func TestWarmPool_ReplenishToTarget(t *testing.T) {
	client := fake.NewSimpleClientset()
	m := NewWarmPoolManager(client, warmCfg(config.WarmPoolSize{Size: "10Gi", Target: 3}))
	m.reconcile(context.Background())

	spares := availablePVCs(t, client, "10Gi")
	require.Len(t, spares, 3)
	for _, p := range spares {
		require.NotNil(t, p.Spec.StorageClassName)
		assert.Equal(t, "platform-rwx-immediate", *p.Spec.StorageClassName)
		assert.Equal(t, corev1.ReadWriteMany, p.Spec.AccessModes[0])
		req := p.Spec.Resources.Requests[corev1.ResourceStorage]
		assert.Equal(t, "10Gi", req.String())
		assert.NotContains(t, p.Labels, LabelAgent, "an unclaimed spare must not carry the agent label")
	}
}

func TestWarmPool_CountExcludesClaimed(t *testing.T) {
	now := time.Now()
	client := fake.NewSimpleClientset(
		availableSpare("p-bound-1", "10Gi", corev1.ClaimBound, now),
		availableSpare("p-bound-2", "10Gi", corev1.ClaimBound, now),
		claimedSpare("p-claimed", "10Gi", "some-agent", "home-agent"),
	)
	m := NewWarmPoolManager(client, warmCfg(config.WarmPoolSize{Size: "10Gi", Target: 3}))
	m.now = func() time.Time { return now }
	m.reconcile(context.Background())

	// 2 available + 1 freshly created = 3; the claimed PVC is never counted.
	assert.Len(t, availablePVCs(t, client, "10Gi"), 3)
	claimed, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), "p-claimed", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "some-agent", claimed.Labels[LabelAgent], "claimed spare untouched")
}

func TestWarmPool_NoOverProvisionWhilePending(t *testing.T) {
	now := time.Now()
	client := fake.NewSimpleClientset(
		availableSpare("p-pending-1", "10Gi", corev1.ClaimPending, now),
		availableSpare("p-pending-2", "10Gi", corev1.ClaimPending, now),
	)
	m := NewWarmPoolManager(client, warmCfg(config.WarmPoolSize{Size: "10Gi", Target: 2}))
	m.now = func() time.Time { return now }
	m.reconcile(context.Background())

	// Two fresh Pending spares already cover the target — create none.
	assert.Len(t, availablePVCs(t, client, "10Gi"), 2)
}

func TestWarmPool_GCStalePending(t *testing.T) {
	now := time.Now()
	client := fake.NewSimpleClientset(
		availableSpare("p-stuck", "10Gi", corev1.ClaimPending, now.Add(-time.Hour)),
	)
	m := NewWarmPoolManager(client, warmCfg(config.WarmPoolSize{Size: "10Gi", Target: 0}))
	m.now = func() time.Time { return now }
	m.reconcile(context.Background())

	// Pending far longer than maxPendingAge (default 30m) → reclaimed; target 0 → none created.
	assert.Empty(t, availablePVCs(t, client, "10Gi"))
}

func TestWarmPool_GCExcessBoundOldestFirst(t *testing.T) {
	base := time.Now().Add(-time.Hour)
	client := fake.NewSimpleClientset(
		availableSpare("p0", "10Gi", corev1.ClaimBound, base.Add(0*time.Minute)),
		availableSpare("p1", "10Gi", corev1.ClaimBound, base.Add(1*time.Minute)),
		availableSpare("p2", "10Gi", corev1.ClaimBound, base.Add(2*time.Minute)),
		availableSpare("p3", "10Gi", corev1.ClaimBound, base.Add(3*time.Minute)),
		availableSpare("p4", "10Gi", corev1.ClaimBound, base.Add(4*time.Minute)),
	)
	m := NewWarmPoolManager(client, warmCfg(config.WarmPoolSize{Size: "10Gi", Target: 2}))
	m.reconcile(context.Background())

	spares := availablePVCs(t, client, "10Gi")
	require.Len(t, spares, 2)
	got := map[string]bool{}
	for _, p := range spares {
		got[p.Name] = true
	}
	assert.True(t, got["p3"] && got["p4"], "the two newest survive, got %v", got)
}

func TestWarmPool_GCRemovedPool(t *testing.T) {
	client := fake.NewSimpleClientset(
		availableSpare("p-5gi", "5Gi", corev1.ClaimBound, time.Now()),
	)
	// Only 10Gi is configured now — the 5Gi pool was removed.
	m := NewWarmPoolManager(client, warmCfg(config.WarmPoolSize{Size: "10Gi", Target: 1}))
	m.reconcile(context.Background())

	assert.Empty(t, availablePVCs(t, client, "5Gi"), "spare for a removed pool is reclaimed")
	assert.Len(t, availablePVCs(t, client, "10Gi"), 1, "configured pool fills to target")
}

func TestWarmPool_DisabledIsNoop(t *testing.T) {
	client := fake.NewSimpleClientset()
	cfg := warmCfg(config.WarmPoolSize{Size: "10Gi", Target: 3})
	cfg.WarmPool.Enabled = false
	m := NewWarmPoolManager(client, cfg)
	m.RunLoop(context.Background()) // returns immediately when disabled

	all, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	assert.Empty(t, all.Items)
}
