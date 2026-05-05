package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

func TestWriteInstanceStatus(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance", Namespace: "test-agents"},
		Data:       map[string]string{"spec.yaml": "desiredState: running"},
	}
	client := fake.NewSimpleClientset(cm)
	status := &types.InstanceStatus{CurrentState: "running"}

	err := WriteInstanceStatus(context.Background(), client, "test-agents", "my-instance", status)
	require.NoError(t, err)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: running")
	assert.Equal(t, "desiredState: running", updated.Data["spec.yaml"])
}

func TestWriteInstanceStatus_Error(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance", Namespace: "test-agents"},
		Data:       map[string]string{"spec.yaml": "desiredState: running"},
	}
	client := fake.NewSimpleClientset(cm)
	status := &types.InstanceStatus{CurrentState: "error", Error: "template not found"}

	err := WriteInstanceStatus(context.Background(), client, "test-agents", "my-instance", status)
	require.NoError(t, err)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "error: template not found")
}

func TestWriteInstanceStatus_NotFound(t *testing.T) {
	client := fake.NewSimpleClientset()
	status := &types.InstanceStatus{CurrentState: "running"}
	err := WriteInstanceStatus(context.Background(), client, "test-agents", "missing", status)
	assert.Error(t, err)
}

func TestWriteScheduleStatus(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "my-schedule", Namespace: "test-agents"},
		Data:       map[string]string{"spec.yaml": "cron: '*/5 * * * *'"},
	}
	client := fake.NewSimpleClientset(cm)
	status := &types.ScheduleStatus{LastRun: "2026-04-01T14:00:00Z", NextRun: "2026-04-01T14:30:00Z", LastResult: "success"}

	err := WriteScheduleStatus(context.Background(), client, "test-agents", "my-schedule", status)
	require.NoError(t, err)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-schedule", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "lastResult: success")
	assert.Contains(t, updated.Data["spec.yaml"], "cron:")
}
