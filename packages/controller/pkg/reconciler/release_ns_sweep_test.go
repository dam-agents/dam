package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TEST_OVERVIEW: The release-namespace sweep. An Agent's ext-authz Service and
// TEST_OVERVIEW: its two AuthorizationPolicies cannot be owned across namespaces, so a delete
// TEST_OVERVIEW: that gave up, or an anchor removed out of band, leaves them behind. The sweep
// TEST_OVERVIEW: removes them only when the Agent's row is gone, only after the same grace a
// TEST_OVERVIEW: machine and an anchor get, and never for an Agent that is still there.

// TEST_SCENARIO: A live Agent's release-namespace objects are left alone, and the
// TEST_SCENARIO: ones whose Agent is gone survive until the grace has run out.
func TestReleaseNsSweepRemovesOnlyOrphansAfterTheGrace(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: "owner-1"}
	r, client := setupReconciler(t, agent)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	r.WithAgentBackend(backend)

	ctx := context.Background()
	_, err := client.CoreV1().Services(r.config.ReleaseNamespace).Create(ctx, &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      r.config.ExtAuthzServiceName("my-agent"),
			Namespace: r.config.ReleaseNamespace,
			Labels:    map[string]string{LabelAgent: "my-agent"},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = client.CoreV1().Services(r.config.ReleaseNamespace).Create(ctx, &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      r.config.ExtAuthzServiceName("gone-agent"),
			Namespace: r.config.ReleaseNamespace,
			Labels:    map[string]string{LabelAgent: "gone-agent"},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	now := time.Now()
	r.clock = func() time.Time { return now }
	require.NoError(t, r.ReconcileOrphanReleaseNsResources(ctx))
	_, err = client.CoreV1().Services(r.config.ReleaseNamespace).Get(ctx, r.config.ExtAuthzServiceName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "a live Agent's ext-authz Service was removed")
	_, err = client.CoreV1().Services(r.config.ReleaseNamespace).Get(ctx, r.config.ExtAuthzServiceName("gone-agent"), metav1.GetOptions{})
	require.NoError(t, err, "an orphan was removed before its grace ran out")

	now = now.Add(orphanGrace + time.Minute)
	require.NoError(t, r.ReconcileOrphanReleaseNsResources(ctx))
	_, err = client.CoreV1().Services(r.config.ReleaseNamespace).Get(ctx, r.config.ExtAuthzServiceName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "a live Agent's ext-authz Service was removed")
	_, err = client.CoreV1().Services(r.config.ReleaseNamespace).Get(ctx, r.config.ExtAuthzServiceName("gone-agent"), metav1.GetOptions{})
	assert.True(t, apierrors.IsNotFound(err), "an orphan outlived its grace")
}
