package scheduler

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// rruleScheduleCM builds a schedule ConfigMap with an rrule-type spec.
// Callers embed the rrule body + quiet hours YAML inline so each test
// can express exactly what it's exercising.
func rruleScheduleCM(name, instanceName, specBody string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{
				"agent-platform.ai/type":     "agent-schedule",
				"agent-platform.ai/agent": instanceName,
			},
		},
		Data: map[string]string{"spec.yaml": specBody},
	}
}

// runningInstanceCM is the minimum state fire() needs to succeed without a
// real pod: the instance ConfigMap with desiredState=running and restCfg
// left nil (so the exec step is skipped — fire returns success after
// "trigger delivered" logging). Tests that actually reach fire() must also
// seed a readyPod so EnsureReady's pod-Ready check passes.
func runningInstanceCM(name string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{"agent-platform.ai/type": "agent"},
		},
		Data: map[string]string{"spec.yaml": "version: agent-platform.ai/v1\nimage: foo\ndesiredState: running\n"},
	}
}

// readyPod returns a Pod with PodReady=True so EnsureReady's poll succeeds
// without the test having to simulate a reconciler scaling up a StatefulSet.
func readyPod(instanceName string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: instanceName + "-0", Namespace: "test-agents"},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
	}
}

func TestSyncSchedule_RRule_Enabled(t *testing.T) {
	spec := `version: agent-platform.ai/v1
type: rrule
rrule: "FREQ=HOURLY"
timezone: UTC
task: ping
enabled: true
`
	cm := rruleScheduleCM("sched-rrule", "my-instance", spec)
	client := fake.NewSimpleClientset(cm, runningInstanceCM("my-instance"))
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	assert.Contains(t, s.rruleJobs, "sched-rrule")
	assert.NotContains(t, s.schedules, "sched-rrule", "rrule schedules must not land in the cron map")

	// Initial nextRun should be published synchronously so the UI shows it
	// before the first fire.
	got, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "sched-rrule", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, got.Data["status.yaml"], "nextRun:",
		"registration must publish initial nextRun so the UI has it immediately")
}

func TestSyncSchedule_RRule_Disabled(t *testing.T) {
	spec := `version: agent-platform.ai/v1
type: rrule
rrule: "FREQ=HOURLY"
timezone: UTC
enabled: false
`
	cm := rruleScheduleCM("sched-rrule", "my-instance", spec)
	client := fake.NewSimpleClientset(cm, runningInstanceCM("my-instance"))
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	assert.NotContains(t, s.rruleJobs, "sched-rrule")
}

func TestSyncSchedule_RRule_Invalid(t *testing.T) {
	spec := `version: agent-platform.ai/v1
type: rrule
rrule: "THIS IS NOT A VALID RRULE"
timezone: UTC
enabled: true
`
	cm := rruleScheduleCM("sched-rrule", "my-instance", spec)
	client := fake.NewSimpleClientset(cm, runningInstanceCM("my-instance"))
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	err := s.SyncSchedule(cm)
	require.Error(t, err)
	assert.NotContains(t, s.rruleJobs, "sched-rrule")
}

// TestSyncSchedule_RRule_Idempotent guards against the regression where
// informer resyncs (or any status-only write) caused SyncSchedule to tear
// down and recreate the rrule goroutine — starving schedules whose period
// exceeded the resync interval.
func TestSyncSchedule_RRule_Idempotent(t *testing.T) {
	spec := `version: agent-platform.ai/v1
type: rrule
rrule: "FREQ=HOURLY"
timezone: UTC
task: ping
enabled: true
`
	cm := rruleScheduleCM("sched-rrule", "my-instance", spec)
	client := fake.NewSimpleClientset(cm, runningInstanceCM("my-instance"))
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	s.mu.Lock()
	firstCancel := s.rruleJobs["sched-rrule"]
	s.mu.Unlock()
	require.NotNil(t, firstCancel)

	// Re-sync the same ConfigMap (simulates informer resync / status write).
	require.NoError(t, s.SyncSchedule(cm))
	s.mu.Lock()
	secondCancel := s.rruleJobs["sched-rrule"]
	s.mu.Unlock()

	// Identity comparison: the map must still hold the *same* CancelFunc,
	// i.e. the goroutine was not replaced.
	assert.Equal(t,
		fmt.Sprintf("%p", firstCancel),
		fmt.Sprintf("%p", secondCancel),
		"SyncSchedule with unchanged spec must be a no-op — goroutine should not be recreated")
}

func TestRemoveSchedule_RRule(t *testing.T) {
	spec := `version: agent-platform.ai/v1
type: rrule
rrule: "FREQ=HOURLY"
timezone: UTC
enabled: true
`
	cm := rruleScheduleCM("sched-rrule", "my-instance", spec)
	client := fake.NewSimpleClientset(cm, runningInstanceCM("my-instance"))
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	assert.Contains(t, s.rruleJobs, "sched-rrule")

	s.RemoveSchedule("sched-rrule")
	assert.NotContains(t, s.rruleJobs, "sched-rrule")
}

// TestRunRRuleJob_FiresOutsideQuietHours verifies the happy path:
// a SECONDLY rrule with no quiet hours fires within ~2s and writes a
// success status. This exercises the full goroutine loop end-to-end
// (without a real pod; fire() skips the exec step when restCfg is nil).
func TestRunRRuleJob_FiresOutsideQuietHours(t *testing.T) {
	spec := `version: agent-platform.ai/v1
type: rrule
rrule: "FREQ=SECONDLY"
timezone: UTC
task: ping
enabled: true
`
	cm := rruleScheduleCM("sched-rrule", "my-instance", spec)
	client := fake.NewSimpleClientset(cm, runningInstanceCM("my-instance"), readyPod("my-instance"))
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()
	require.NoError(t, s.SyncSchedule(cm))

	// Poll the schedule CM until its status.yaml lands with lastResult.
	assert.Eventually(t, func() bool {
		got, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "sched-rrule", metav1.GetOptions{})
		if err != nil {
			return false
		}
		return containsAll(got.Data["status.yaml"], "lastResult: success")
	}, 3*time.Second, 100*time.Millisecond, "expected a success status within ~3s")
}

// TestRunRRuleJob_QuietHoursSuppresses builds a quiet window around "now"
// and asserts the schedule does NOT fire for the full suppression window:
// pre-filter design means `status.yaml` is never written while all
// occurrences are quiet. Window is 3 minutes wide, centered on now, so it
// reliably contains every occurrence during the test's run.
func TestRunRRuleJob_QuietHoursSuppresses(t *testing.T) {
	now := time.Now().UTC()
	startT := now.Add(-1 * time.Minute)
	endT := now.Add(2 * time.Minute)
	startHHMM := fmt.Sprintf("%02d:%02d", startT.Hour(), startT.Minute())
	endHHMM := fmt.Sprintf("%02d:%02d", endT.Hour(), endT.Minute())

	spec := fmt.Sprintf(`version: agent-platform.ai/v1
type: rrule
rrule: "FREQ=SECONDLY"
timezone: UTC
quietHours:
  - startTime: "%s"
    endTime: "%s"
    enabled: true
task: ping
enabled: true
`, startHHMM, endHHMM)

	cm := rruleScheduleCM("sched-rrule", "my-instance", spec)
	client := fake.NewSimpleClientset(cm, runningInstanceCM("my-instance"))
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()
	require.NoError(t, s.SyncSchedule(cm))

	// Wait well past when a SECONDLY rule would otherwise have fired; the
	// pre-filter means no fire happens inside the window. status.yaml may
	// still carry a nextRun (published at registration, pointing past the
	// window) but must not show lastResult — that only appears on a real fire.
	time.Sleep(2 * time.Second)
	got, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "sched-rrule", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotContains(t, got.Data["status.yaml"], "lastResult",
		"schedule should not have fired while fully inside quiet hours")
}

// containsAll returns true iff every `needle` appears in `haystack`.
// Factored out so the status-shape assertions above read cleanly.
func containsAll(haystack string, needles ...string) bool {
	for _, n := range needles {
		if !strings.Contains(haystack, n) {
			return false
		}
	}
	return true
}
