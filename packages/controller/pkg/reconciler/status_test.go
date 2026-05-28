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

func TestWriteAgentStatus(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance", Namespace: "test-agents"},
		Data:       map[string]string{"spec.yaml": "desiredState: running"},
	}
	client := fake.NewSimpleClientset(cm)
	status := &types.AgentStatus{CurrentState: "running"}

	err := WriteAgentStatus(context.Background(), client, "test-agents", "my-instance", status)
	require.NoError(t, err)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: running")
	assert.Equal(t, "desiredState: running", updated.Data["spec.yaml"])
}

func TestWriteAgentStatus_Error(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance", Namespace: "test-agents"},
		Data:       map[string]string{"spec.yaml": "desiredState: running"},
	}
	client := fake.NewSimpleClientset(cm)
	status := &types.AgentStatus{CurrentState: "error", Error: "template not found"}

	err := WriteAgentStatus(context.Background(), client, "test-agents", "my-instance", status)
	require.NoError(t, err)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "error: template not found")
}

func TestWriteAgentStatus_NotFound(t *testing.T) {
	client := fake.NewSimpleClientset()
	status := &types.AgentStatus{CurrentState: "running"}
	err := WriteAgentStatus(context.Background(), client, "test-agents", "missing", status)
	assert.Error(t, err)
}

