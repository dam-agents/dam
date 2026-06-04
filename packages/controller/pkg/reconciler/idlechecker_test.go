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

func idleCheckerCfg(timeout time.Duration) *config.Config {
	return &config.Config{
		Namespace: "test-agents",
		AgentBase: config.AgentBase{
			IdleTimeout: config.Duration(timeout),
		},
	}
}

func runningInstanceCM(name, lastActivity string, annotations map[string]string) *corev1.ConfigMap {
	if annotations == nil {
		annotations = make(map[string]string)
	}
	if lastActivity != "" {
		annotations["agent-platform.ai/last-activity"] = lastActivity
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{
				"agent-platform.ai/type": "agent",
			},
			Annotations: annotations,
		},
		Data: map[string]string{
			"spec.yaml": "version: agent-platform.ai/v1\nimage: foo\ndesiredState: running\n",
		},
	}
}

func TestIdleChecker_HibernatesIdleInstance(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	cm := runningInstanceCM("idle-agent", staleTime, nil)
	client := fake.NewSimpleClientset(cm)
	checker := NewIdleChecker(client, idleCheckerCfg(1*time.Hour))

	checker.check(context.Background())

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "idle-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: hibernated")
}

func TestIdleChecker_SkipsRecentlyActiveInstance(t *testing.T) {
	recentTime := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)
	cm := runningInstanceCM("active-agent", recentTime, nil)
	client := fake.NewSimpleClientset(cm)
	checker := NewIdleChecker(client, idleCheckerCfg(1*time.Hour))

	checker.check(context.Background())

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "active-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: running")
}

func TestIdleChecker_SkipsActiveSession(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	cm := runningInstanceCM("session-agent", staleTime, map[string]string{
		"agent-platform.ai/active-session": "true",
	})
	client := fake.NewSimpleClientset(cm)
	checker := NewIdleChecker(client, idleCheckerCfg(1*time.Hour))

	checker.check(context.Background())

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "session-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: running")
}

func TestIdleChecker_SkipsNoLastActivity(t *testing.T) {
	cm := runningInstanceCM("new-agent", "", nil)
	client := fake.NewSimpleClientset(cm)
	checker := NewIdleChecker(client, idleCheckerCfg(1*time.Hour))

	checker.check(context.Background())

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "new-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: running")
}

func TestIdleChecker_SkipsAlreadyHibernated(t *testing.T) {
	staleTime := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	cm := runningInstanceCM("hibernated-agent", staleTime, nil)
	cm.Data["spec.yaml"] = "version: agent-platform.ai/v1\nimage: foo\ndesiredState: hibernated\n"
	client := fake.NewSimpleClientset(cm)
	checker := NewIdleChecker(client, idleCheckerCfg(1*time.Hour))

	checker.check(context.Background())

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "hibernated-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: hibernated")
}

func TestIdleChecker_CheckInterval(t *testing.T) {
	tests := []struct {
		timeout  time.Duration
		expected time.Duration
	}{
		{1 * time.Hour, 5 * time.Minute},                   // 10m clamped to 5m
		{3 * time.Minute, 30 * time.Second},                // 30s clamped to 30s
		{15 * time.Minute, 2*time.Minute + 30*time.Second}, // 2m30s within range
	}
	for _, tt := range tests {
		checker := NewIdleChecker(nil, idleCheckerCfg(tt.timeout))
		assert.Equal(t, tt.expected, checker.checkInterval(), "timeout=%v", tt.timeout)
	}
}
