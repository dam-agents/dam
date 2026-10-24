package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: The anchor pass hands every child of every Agent to its anchor,
// TEST_OVERVIEW: whatever the fleet is doing. A reconcile adopts what it renders, but one
// TEST_OVERVIEW: that fails before reaching a child — a machine on an unreachable runner is
// TEST_OVERVIEW: enough — must not leave that child owned by a custom resource the contract
// TEST_OVERVIEW: release deletes.

// TEST_SCENARIO: A live Agent's StatefulSet still names the custom resource, and
// TEST_SCENARIO: the startup pass is the only step that runs: the StatefulSet must end up owned
// TEST_SCENARIO: by the anchor, with no reference to the custom resource left.
func TestTheAnchorPassHandsChildrenToTheAnchor(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: "owner-1"}
	r, client := setupReconciler(t, agent)
	backend := newRecordingBackend(crAgentBackend{dynamic: r.dynamic, namespace: r.config.Namespace})
	r.WithAgentBackend(backend)

	ctx := context.Background()
	_, err := client.AppsV1().StatefulSets(r.config.Namespace).Create(ctx, &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent",
			Namespace: r.config.Namespace,
			Labels:    map[string]string{LabelAgent: "my-agent"},
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: apiv1.GroupVersion.String(),
				Kind:       "Agent",
				Name:       "my-agent",
				UID:        agent.UID,
			}},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = client.CoreV1().Secrets(r.config.Namespace).Create(ctx, &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-agent-envoy-tls",
			Namespace: r.config.Namespace,
			Labels:    map[string]string{LabelAgent: "my-agent"},
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: apiv1.GroupVersion.String(),
				Kind:       "Agent",
				Name:       "my-agent",
				UID:        agent.UID,
			}},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	pending, err := r.EnsureAnchors(ctx, func(string) {})
	require.NoError(t, err)
	assert.Equal(t, 0, pending)

	anchor, err := client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, anchorName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	statefulSet, err := client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, statefulSet.OwnerReferences, 1)
	assert.Equal(t, "ConfigMap", statefulSet.OwnerReferences[0].Kind)
	assert.Equal(t, anchor.UID, statefulSet.OwnerReferences[0].UID)
	secret, err := client.CoreV1().Secrets(r.config.Namespace).Get(ctx, "my-agent-envoy-tls", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, secret.OwnerReferences, 1)
	assert.Equal(t, anchor.UID, secret.OwnerReferences[0].UID)
}
