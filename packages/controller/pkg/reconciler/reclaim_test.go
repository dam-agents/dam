package reconciler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	dynfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
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
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
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
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
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
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
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
	r.podStatus = func(context.Context, string) (bool, bool) { return false, true }
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(1), agentSSReplicas(t, r, "peer"), "busy peer must not be reclaimed")
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "my-agent"))
}

// TEST_SCENARIO: an idle probe takes a round trip, and the api-server writes a session pin without taking the controller's owner lock. A pin that lands after the victim was chosen but before it is stamped must keep it awake: a user who just opened the agent must not have it put to sleep under them.
func TestReclaimLeavesAPeerPinnedWhileItsIdleProbeRan(t *testing.T) {
	peer, peerSS := idlePeer("peer", "3900m", "1Gi", 10*time.Minute, nil)
	agent := ownedAgentCR("my-agent", "250m", "512Mi")

	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)
	r, _ := setupReconciler(t, agent, peerSS)
	r.podStatus = func(ctx context.Context, name string) (bool, bool) {
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, name, types.MergePatchType,
			[]byte(`{"metadata":{"annotations":{"`+annActiveSession+`":"true"}}}`), metav1.PatchOptions{})
		require.NoError(t, err)
		return true, true
	}
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(1), agentSSReplicas(t, r, "peer"), "a pin landing during the idle probe must keep the peer awake")
	assert.False(t, reclaimedAgent(t, r, "peer"))
}

// TEST_SCENARIO: a write between the victim's re-read and its reclaim stamp fails the stamp on its resource version. That conflict is the pin of the previous scenario arriving a moment later, so the victim is left awake rather than halted on a stamp that lost.
func TestReclaimLeavesAPeerWhoseStampConflicts(t *testing.T) {
	peer, peerSS := idlePeer("peer", "3900m", "1Gi", 10*time.Minute, nil)
	agent := ownedAgentCR("my-agent", "250m", "512Mi")

	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)
	r, _ := setupReconciler(t, agent, peerSS)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("patch", "agents", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if a.(k8stesting.PatchAction).GetName() != "peer" {
			return false, nil, nil
		}
		return true, nil, apierrors.NewConflict(AgentsGVR.GroupResource(), "peer", errors.New("the object has been modified"))
	})
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	assert.Equal(t, int32(1), agentSSReplicas(t, r, "peer"), "a victim whose stamp conflicts must not be halted")
	assert.False(t, reclaimedAgent(t, r, "peer"))
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
		{"waiting on its sub-agents", map[string]string{annLastActivity: idle(10 * time.Minute), annInvocationsActive: "true"}, time.Hour, false},
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
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
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
