package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

func idlePeer(name, cpu, memory string, idleFor time.Duration, extra map[string]string) (*apiv1.Agent, *appsv1.StatefulSet) {
	peer, ss := runningPeer(name, cpu, memory)
	peer.Annotations = map[string]string{
		annLastActivity: time.Now().UTC().Add(-idleFor).Format(time.RFC3339),
	}
	for k, v := range extra {
		peer.Annotations[k] = v
	}
	return peer, ss
}

func TestReclaimAdmitsBlockedStartByHibernatingIdlePeer(t *testing.T) {
	peer, peerSS := idlePeer("peer", "3900m", "1Gi", 10*time.Minute, nil)
	agent := ownedAgentCR("my-agent", "250m", "512Mi")

	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)
	r, _ := setupReconciler(t, agent, peerSS)
	r.busyProbe = func(context.Context, string) bool { return false }
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"), "candidate should be admitted after reclaim")
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "peer"), "idle peer should have been hibernated")
	cond := readyCondition(t, r, "my-agent")
	if cond != nil {
		assert.NotEqual(t, apiv1.ReasonOverBudget, cond.Reason)
	}

	peerCond := readyCondition(t, r, "peer")
	require.NotNil(t, peerCond)
	assert.Equal(t, apiv1.ReasonHibernated, peerCond.Reason)
}

func TestReclaimedPeerStaysDownUnderTheActivityItWasReclaimedUnder(t *testing.T) {
	stamp := time.Now().UTC()
	ann := map[string]string{
		annLastActivity: stamp.Add(-10 * time.Minute).Format(time.RFC3339),
		annReclaimedAt:  stamp.Format(time.RFC3339),
	}
	assert.False(t, shouldRun(ann, time.Hour, stamp), "reclaimed peer must not restart on its spent activity stamp")

	ann[annLastActivity] = stamp.Add(time.Second).Format(time.RFC3339)
	assert.True(t, shouldRun(ann, time.Hour, stamp.Add(time.Second)), "a newer bump must revive a reclaimed peer")
}

func TestReclaimedVictimStaysDownOnItsOwnNextReconcile(t *testing.T) {
	peer, peerSS := idlePeer("peer", "3900m", "1Gi", 10*time.Minute, nil)
	agent := ownedAgentCR("my-agent", "250m", "512Mi")

	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)
	r, _ := setupReconciler(t, agent, peerSS)
	r.busyProbe = func(context.Context, string) bool { return false }
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))
	require.Equal(t, int32(0), agentSSReplicas(t, r, "peer"), "precondition: peer was reclaimed")

	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "peer", metav1.GetOptions{})
	require.NoError(t, err)
	reclaimed, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	require.NotEmpty(t, reclaimed.Annotations[annReclaimedAt], "reclaim must stamp the victim, else its next reconcile takes the room back")

	require.NoError(t, r.Reconcile(context.Background(), reclaimed))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "peer"), "reclaimed victim must stay down")
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"), "claimant must keep the room it was admitted with")
}

func TestReclaimHibernatesNothingWhenRoomIsInsufficient(t *testing.T) {
	small, smallSS := idlePeer("small-peer", "250m", "256Mi", 10*time.Minute, nil)
	big, bigSS := runningPeer("big-peer", "3500m", "1Gi")
	agent := ownedAgentCR("my-agent", "1", "512Mi")

	r, _ := setupReconciler(t, agent, smallSS, bigSS)
	r.busyProbe = func(context.Context, string) bool { return false }
	for _, p := range []*apiv1.Agent{small, big} {
		u, err := agentToUnstructured(p)
		require.NoError(t, err)
		_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), u, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"), "start should stay refused")
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "small-peer"), "insufficient room ⇒ hibernate nothing")
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonOverBudget, cond.Reason)
}

func TestReclaimSkipsBusyPeer(t *testing.T) {
	peer, peerSS := idlePeer("peer", "3900m", "1Gi", 10*time.Minute, nil)
	agent := ownedAgentCR("my-agent", "250m", "512Mi")

	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)
	r, _ := setupReconciler(t, agent, peerSS)
	r.busyProbe = func(context.Context, string) bool { return true }
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(1), agentSSReplicas(t, r, "peer"), "busy peer must not be reclaimed")
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
}

func TestReclaimEligibility(t *testing.T) {
	now := time.Now().UTC()
	idle := func(d time.Duration) string { return now.Add(-d).Format(time.RFC3339) }

	cases := []struct {
		name        string
		annotations map[string]string
		timeout     time.Duration
		eligible    bool
	}{
		{"unattended and past the floor", map[string]string{annLastActivity: idle(10 * time.Minute)}, time.Hour, true},
		{"inside the idle floor", map[string]string{annLastActivity: idle(time.Minute)}, time.Hour, false},
		{"never-hibernate declares always run", map[string]string{annLastActivity: idle(time.Hour)}, 0, false},
		{"attached session", map[string]string{annLastActivity: idle(10 * time.Minute), annActiveSession: "true"}, time.Hour, false},
		{"driving an experiment", map[string]string{annLastActivity: idle(10 * time.Minute), annExperimentActive: "true"}, time.Hour, false},
		{"invocation target with a blocked driver", map[string]string{annLastActivity: idle(10 * time.Minute), annSweepable: "true"}, time.Hour, false},
		{"already hard-stopped", map[string]string{annLastActivity: idle(10 * time.Minute), annStopRequested: "now"}, time.Hour, false},
		{"migrating storage", map[string]string{annLastActivity: idle(10 * time.Minute), annStorageMigration: "now"}, time.Hour, false},
		{"no activity stamp fails open", map[string]string{}, time.Hour, false},
		{"unparseable stamp fails open", map[string]string{annLastActivity: "not-a-time"}, time.Hour, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, ok := reclaimEligible(tc.annotations, tc.timeout, now)
			assert.Equal(t, tc.eligible, ok)
		})
	}
}

func TestReclaimPrefersLongestIdlePeer(t *testing.T) {
	recent, recentSS := idlePeer("recent-peer", "1900m", "1Gi", 5*time.Minute, nil)
	stale, staleSS := idlePeer("stale-peer", "1900m", "1Gi", 30*time.Minute, nil)
	agent := ownedAgentCR("my-agent", "250m", "512Mi")

	r, _ := setupReconciler(t, agent, recentSS, staleSS)
	r.busyProbe = func(context.Context, string) bool { return false }
	for _, p := range []*apiv1.Agent{recent, stale} {
		u, err := agentToUnstructured(p)
		require.NoError(t, err)
		_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), u, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(0), agentSSReplicas(t, r, "stale-peer"), "longest-idle peer should pay")
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "recent-peer"), "more recently used peer should survive")
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"))
}
