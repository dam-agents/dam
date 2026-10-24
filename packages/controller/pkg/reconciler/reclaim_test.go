package reconciler

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

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
		{"no activity stamp fails open", map[string]string{}, time.Hour, false},
		{"unparseable stamp fails open", map[string]string{annLastActivity: "not-a-time"}, time.Hour, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, ok := reclaimEligible(&apiv1.Agent{ObjectMeta: metav1.ObjectMeta{Annotations: tc.annotations}}, tc.timeout, now, reclaimIdleFloor)
			assert.Equal(t, tc.eligible, ok)
		})
	}
}
