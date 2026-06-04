package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ADR-041: per-instance SA shape — name == instance ID, lives in agent ns,
// AutomountServiceAccountToken explicitly false, owner-refed to the
// instance ConfigMap so K8s GC reaps it on instance delete.
func TestBuildServiceAccount_Shape(t *testing.T) {
	sa := BuildServiceAccount("my-instance", testConfig, configMapOwnerRef(testOwnerCM))

	assert.Equal(t, "my-instance", sa.Name)
	assert.Equal(t, testConfig.Namespace, sa.Namespace)
	assert.Equal(t, "my-instance", sa.Labels[LabelAgent])
	require.NotNil(t, sa.AutomountServiceAccountToken)
	assert.False(t, *sa.AutomountServiceAccountToken,
		"SPIFFE identity is independent of SA-token mounts; the agent + gateway pods stay credential-free at the K8s API surface")
	require.Len(t, sa.OwnerReferences, 1)
	assert.Equal(t, testOwnerCM.UID, sa.OwnerReferences[0].UID)
}

// ADR-041: the SA name is whatever the caller passes — long-lived pairs
// pass the instance name, forks pass the fork name (forks have their own
// per-fork SA, see ADR-027 + authorization_policy.go). This test pins the
// contract: name == argument, no implicit transformation.
func TestBuildServiceAccount_NameEqualsInstanceID(t *testing.T) {
	for _, id := range []string{"abc", "instance-with-dashes", "x"} {
		sa := BuildServiceAccount(id, testConfig, configMapOwnerRef(testOwnerCM))
		assert.Equal(t, id, sa.Name, "SA name must equal the instance ID — peer principal SA name is the URL :id contract")
	}
}

// ADR-041: idempotent reconcile — labels and AutomountServiceAccountToken
// must heal on drift (e.g. a pre-existing SA from a prior install or
// manual creation). Without this, a drifted SA silently bypasses the
// owner-ref + token guarantees.
func TestApplyServiceAccount_HealsLabelDrift(t *testing.T) {
	agent := agentCR()
	// Override the agent name to match the SA we pre-create below.
	agent.Name = "my-instance"
	r, client := setupReconciler(t, agent)
	// Pre-create a drifted SA with no owner-ref and AutomountSA=nil.
	pre := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-instance",
			Namespace: testConfig.Namespace,
			Labels:    map[string]string{"unrelated": "stays"},
		},
		// AutomountServiceAccountToken intentionally nil to simulate drift.
	}
	_, err := client.CoreV1().ServiceAccounts(testConfig.Namespace).Create(t.Context(), pre, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.ensureServiceAccount(t.Context(), "my-instance", agentOwnerRef(agent)))

	got, err := client.CoreV1().ServiceAccounts(testConfig.Namespace).Get(t.Context(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-instance", got.Labels[LabelAgent], "instance label must be reconciled onto a pre-existing SA")
	assert.Equal(t, "stays", got.Labels["unrelated"], "unrelated labels from other controllers must be preserved")
	require.NotNil(t, got.AutomountServiceAccountToken)
	assert.False(t, *got.AutomountServiceAccountToken)
	require.Len(t, got.OwnerReferences, 1)
	assert.Equal(t, agent.UID, got.OwnerReferences[0].UID)
}

// testConfig and testOwnerCM are reused across reconciler tests; declared
// in resources_test.go.
