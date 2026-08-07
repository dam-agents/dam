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

// Reclaiming room for a blocked start (#3184). The gate may hibernate the
// owner's own unattended idle agents ahead of their timeout; these cover which
// peers it may touch, that it admits only when the freed room provably covers
// the shortfall, and that a reclaimed victim cannot take its room straight back.

// idlePeer is runningPeer() with an activity stamp aged by `idleFor` — recent
// enough that the peer's own idle timeout (1h in tests) has NOT lapsed, which
// is the whole premise of reclaiming it early.
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
	// Peer holds 3.9 of the 4-CPU default ceiling and has been idle 10 min —
	// well past the 3-min floor, but nowhere near its 1h timeout.
	peer, peerSS := idlePeer("peer", "3900m", "1Gi", 10*time.Minute, nil)
	agent := ownedAgentCR("my-agent", "250m", "512Mi")

	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)
	r, _ := setupReconciler(t, agent, peerSS)
	r.busyProbe = func(context.Context, string) bool { return false }
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(context.Background(), peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(context.Background(), agent))

	// The blocked start is admitted, and it was the peer that paid for it.
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"), "candidate should be admitted after reclaim")
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "peer"), "idle peer should have been hibernated")
	cond := readyCondition(t, r, "my-agent")
	if cond != nil {
		assert.NotEqual(t, apiv1.ReasonOverBudget, cond.Reason)
	}

	// Silent, and indistinguishable from an ordinary hibernation.
	peerCond := readyCondition(t, r, "peer")
	require.NotNil(t, peerCond)
	assert.Equal(t, apiv1.ReasonHibernated, peerCond.Reason)
}

func TestReclaimedPeerStaysDownUnderTheActivityItWasReclaimedUnder(t *testing.T) {
	// The reclaim stamp is what stops the victim's own next reconcile from
	// scaling it back up and stealing the room back — its activity is still
	// inside its timeout.
	stamp := time.Now().UTC()
	ann := map[string]string{
		annLastActivity: stamp.Add(-10 * time.Minute).Format(time.RFC3339),
		annReclaimedAt:  stamp.Format(time.RFC3339),
	}
	assert.False(t, shouldRun(ann, time.Hour, stamp), "reclaimed peer must not restart on its spent activity stamp")

	// A deliberate touch outdates the stamp and the agent runs again.
	ann[annLastActivity] = stamp.Add(time.Second).Format(time.RFC3339)
	assert.True(t, shouldRun(ann, time.Hour, stamp.Add(time.Second)), "a newer bump must revive a reclaimed peer")
}

// The non-recursion guarantee, end to end: a real reclaim must write the stamp,
// and the victim's own next reconcile must leave it down. Without the stamp the
// victim's activity is still inside its timeout, so that reconcile would scale
// it straight back up and steal the room the claimant was just admitted with.
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

	// The stamp must actually have been written to the victim's CR.
	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), "peer", metav1.GetOptions{})
	require.NoError(t, err)
	reclaimed, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	require.NotEmpty(t, reclaimed.Annotations[annReclaimedAt], "reclaim must stamp the victim, else its next reconcile takes the room back")

	// Its own next reconcile must not resurrect it, even though last-activity
	// is still well inside the 1h timeout.
	require.NoError(t, r.Reconcile(context.Background(), reclaimed))
	assert.Equal(t, int32(0), agentSSReplicas(t, r, "peer"), "reclaimed victim must stay down")
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "my-agent"), "claimant must keep the room it was admitted with")
}

func TestReclaimHibernatesNothingWhenRoomIsInsufficient(t *testing.T) {
	// The only idle peer is too small to cover the shortfall: the start must be
	// refused as before, with the peer left running — no agent is killed for a
	// start that was going to be refused anyway.
	small, smallSS := idlePeer("small-peer", "250m", "256Mi", 10*time.Minute, nil)
	big, bigSS := runningPeer("big-peer", "3500m", "1Gi") // no activity stamp ⇒ not reclaimable
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
	// Idle by every annotation, but the runtime reports work in flight.
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

// The eligibility matrix — who the gate may never touch, and why.
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
	// Both peers would individually cover the shortfall; the longest-idle one
	// must be the one that pays.
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
