package scheduler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

var testCfg = &config.Config{Namespace: "test-agents"}

func scheduleCM(name, instanceName string, enabled bool) *corev1.ConfigMap {
	enabledStr := "true"
	if !enabled {
		enabledStr = "false"
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{
				"agent-platform.ai/type":     "agent-schedule",
				"agent-platform.ai/instance": instanceName,
			},
		},
		Data: map[string]string{
			"spec.yaml": "version: agent-platform.ai/v1\ntype: cron\ncron: \"*/5 * * * *\"\ntask: check repo\nenabled: " + enabledStr + "\n",
		},
	}
}

func TestSyncSchedule_Enabled(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	err := s.SyncSchedule(cm)
	require.NoError(t, err)
	assert.Contains(t, s.schedules, "my-schedule")
}

func TestSyncSchedule_Disabled(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", false)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	err := s.SyncSchedule(cm)
	require.NoError(t, err)
	assert.NotContains(t, s.schedules, "my-schedule")
}

func TestSyncSchedule_IdempotentWhenSpecUnchanged(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	firstEntry := s.schedules["my-schedule"]

	// Re-syncing the same spec (e.g. on an informer resync or a status-only
	// write) must be a no-op: the registered cron entry stays the same.
	require.NoError(t, s.SyncSchedule(cm))
	secondEntry := s.schedules["my-schedule"]
	assert.Equal(t, firstEntry, secondEntry, "identical spec must not replace the cron entry")
}

func TestSyncSchedule_ReplacesEntryWhenSpecChanges(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	firstEntry := s.schedules["my-schedule"]

	// Mutate the cron expression and re-sync: the entry should be replaced.
	cm.Data["spec.yaml"] = "version: agent-platform.ai/v1\ntype: cron\ncron: \"*/10 * * * *\"\ntask: check repo\nenabled: true\n"
	require.NoError(t, s.SyncSchedule(cm))
	secondEntry := s.schedules["my-schedule"]
	assert.NotEqual(t, firstEntry, secondEntry, "changed spec must replace the cron entry")
}

func TestRemoveSchedule(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	s.SyncSchedule(cm)
	assert.Contains(t, s.schedules, "my-schedule")

	s.RemoveSchedule("my-schedule")
	assert.NotContains(t, s.schedules, "my-schedule")
}

func TestRemoveSchedule_NonExistent(t *testing.T) {
	s := New(fake.NewSimpleClientset(), testCfg)
	s.RemoveSchedule("nope") // should not panic
}

func TestFire_RunningInstance(t *testing.T) {
	instanceCm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-instance", Namespace: "test-agents",
			Labels: map[string]string{"agent-platform.ai/type": "agent-instance"},
		},
		Data: map[string]string{
			"spec.yaml": "version: agent-platform.ai/v1\ndesiredState: running\n",
		},
	}
	readyPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance-0", Namespace: "test-agents"},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
	}
	client := fake.NewSimpleClientset(instanceCm, readyPod)
	s := New(client, testCfg)

	spec := &types.ScheduleSpec{Type: "cron", Cron: "*/5 * * * *", Task: "check repo", Enabled: true}
	err := s.fire(context.Background(), "my-instance", "my-schedule", spec)
	require.NoError(t, err)

	instance, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, instance.Data["spec.yaml"], "desiredState: running")
	// EnsureReady always bumps last-activity, even on the hot path — this is
	// what keeps continuous-mode schedules from re-hibernating mid-chain.
	assert.Contains(t, instance.Annotations, "agent-platform.ai/last-activity")
}
