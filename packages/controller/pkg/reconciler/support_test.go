package reconciler

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// UNIT_BOUNDARY_DESCRIPTION: the controller's log, taken whole so a test asserts on what an operator would read there rather than on a return value alone. A record keeps its message and its attributes: a test matches and counts messages, and a failure shows the whole line, message and attributes, so it names the owner, the runner and the list the record is about. The controller logs from several goroutines at once, so the records are guarded.
type capturedLog struct {
	mu      sync.Mutex
	records []slog.Record
}

func captureLog(t *testing.T) *capturedLog {
	t.Helper()
	captured := &capturedLog{}
	previous := slog.Default()
	slog.SetDefault(slog.New(captured))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return captured
}

func (l *capturedLog) Enabled(context.Context, slog.Level) bool { return true }

func (l *capturedLog) Handle(_ context.Context, record slog.Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.records = append(l.records, record)
	return nil
}

func (l *capturedLog) WithAttrs([]slog.Attr) slog.Handler { return l }

func (l *capturedLog) WithGroup(string) slog.Handler { return l }

// UNIT_BOUNDARY_DESCRIPTION: every record the controller logged, in the order it logged them, so a test reads one record's message and attributes or counts them.
func (l *capturedLog) all() []slog.Record {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]slog.Record(nil), l.records...)
}

// UNIT_BOUNDARY_DESCRIPTION: every record's message in order, without its attributes, so a test counts how often one thing was said.
func (l *capturedLog) messages() []string {
	out := []string{}
	for _, record := range l.all() {
		out = append(out, record.Message)
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: the lines whose message is exactly this one, message and attributes together, so an assertion that none was said fails with what each said.
func (l *capturedLog) lines(message string) []string {
	out := []string{}
	for _, record := range l.all() {
		if record.Message != message {
			continue
		}
		var attrs []string
		record.Attrs(func(attr slog.Attr) bool {
			attrs = append(attrs, attr.Key+"="+attr.Value.String())
			return true
		})
		out = append(out, strings.Join(append([]string{record.Message}, attrs...), " "))
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: the value a record carries under this key, and a zero value for a record that carries none.
func logAttr(record slog.Record, key string) slog.Value {
	var found slog.Value
	record.Attrs(func(attr slog.Attr) bool {
		if attr.Key == key {
			found = attr.Value
			return false
		}
		return true
	})
	return found
}

var testConfig = &config.Config{
	Namespace:         "test-agents",
	ReleaseNamespace:  "default",
	ReleaseName:       "platform",
	HarnessServerPort: 4001,
	ExtAuthzPort:      4002,
	EnvoyImage:        "mirror.gcr.io/envoyproxy/envoy:distroless-v1.39.4",
	EnvoyPort:         10000,
	IstioTrustDomain:  "cluster.local",
	IstioWaypointName: "apiserver-waypoint",
	AgentBase: config.AgentBase{
		VMIdleTimeout: config.Duration(5 * time.Minute),
	},
	AgentTemplateDefaults: config.AgentTemplateDefaults{
		StorageSize: "10Gi",
	},
}

var testAgent = &apiv1.AgentSpec{
	Image: "ghcr.io/myorg/agent:latest",
	Mounts: []apiv1.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/tmp", Persist: false},
	},
	Init: "#!/bin/bash\necho hello",
	Env:  []apiv1.EnvVar{{Name: "ACP_PORT", Value: "8080"}},
	Resources: apiv1.ResourceSpec{
		Requests: map[string]string{"cpu": "250m", "memory": "512Mi"},
		Limits:   map[string]string{"cpu": "1", "memory": "2Gi"},
	},
}

var testOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "my-instance",
		Namespace: "test-agents",
		UID:       "cm-uid-123",
	},
}

func credSecret(name, host string) corev1.Secret {
	ann := map[string]string{
		"agent-platform.ai/injection-hosts": `[{"host":"` + host +
			`","headerName":"Authorization","valueFormat":"Bearer {value}","sdsKey":"` +
			sdsFileKeyForHost(host) + `"}]`,
	}
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Annotations: ann,
			Labels: map[string]string{
				"agent-platform.ai/owner":       "owner-1",
				"agent-platform.ai/managed-by":  "api-server",
				"agent-platform.ai/secret-type": "connection",
				"agent-platform.ai/connection":  name,
			},
		},
		Data: map[string][]byte{sdsFileKeyForHost(host): []byte("resources: []")},
	}
}

func envToMap(envs []corev1.EnvVar) map[string]string {
	out := map[string]string{}
	for _, e := range envs {
		out[e.Name] = e.Value
	}
	return out
}

func agentSSReplicas(t *testing.T, r *AgentReconciler, name string) int32 {
	t.Helper()
	ss, err := r.client.AppsV1().StatefulSets("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, ss.Spec.Replicas)
	return *ss.Spec.Replicas
}

func readyCondition(t *testing.T, r *AgentReconciler, name string) *metav1.Condition {
	t.Helper()
	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	a, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	for i := range a.Status.Conditions {
		if a.Status.Conditions[i].Type == apiv1.ConditionReady {
			return &a.Status.Conditions[i]
		}
	}
	return nil
}

func agentRestartStatus(t *testing.T, r *AgentReconciler, name string) (int64, string) {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").
		Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	restarts, _, _ := unstructured.NestedInt64(u.Object, "status", "agentPodRestarts")
	reason, _, _ := unstructured.NestedString(u.Object, "status", "agentPodRestartReason")
	return restarts, reason
}
