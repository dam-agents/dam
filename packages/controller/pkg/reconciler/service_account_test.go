package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ADR-042: per-pair we render TWO SAs — agent (`<id>`) and gateway
// (`<id>-gateway`). Shape: AutomountServiceAccountToken explicitly false,
// owner-refed to the instance ConfigMap so K8s GC reaps both on instance
// delete, instance label points at the pair.
func TestBuildServiceAccount_Shape(t *testing.T) {
	sa := BuildServiceAccount("my-instance", "my-instance", testConfig, testOwnerCM)

	assert.Equal(t, "my-instance", sa.Name)
	assert.Equal(t, testConfig.Namespace, sa.Namespace)
	assert.Equal(t, "my-instance", sa.Labels[LabelInstance])
	require.NotNil(t, sa.AutomountServiceAccountToken)
	assert.False(t, *sa.AutomountServiceAccountToken,
		"SPIFFE identity is independent of SA-token mounts; the agent + gateway pods stay credential-free at the K8s API surface")
	require.Len(t, sa.OwnerReferences, 1)
	assert.Equal(t, testOwnerCM.UID, sa.OwnerReferences[0].UID)
}

// ADR-042: ensureServiceAccount creates both the agent SA (`<id>`) and
// the gateway SA (`<id>-gateway`). The split is what makes
// destination-side AuthorizationPolicy able to admit "the gateway" without
// also admitting "the agent."
func TestEnsureServiceAccount_RendersBothSAs(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)

	require.NoError(t, r.ensureServiceAccount(t.Context(), "my-instance", cm))

	agentSA, err := client.CoreV1().ServiceAccounts(testConfig.Namespace).Get(t.Context(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err, "agent SA `<id>` must be created")
	require.NotNil(t, agentSA.AutomountServiceAccountToken)
	assert.False(t, *agentSA.AutomountServiceAccountToken)

	gatewaySA, err := client.CoreV1().ServiceAccounts(testConfig.Namespace).Get(t.Context(), "my-instance-gateway", metav1.GetOptions{})
	require.NoError(t, err, "gateway SA `<id>-gateway` must be created")
	require.NotNil(t, gatewaySA.AutomountServiceAccountToken)
	assert.False(t, *gatewaySA.AutomountServiceAccountToken)
	assert.Equal(t, "my-instance", gatewaySA.Labels[LabelInstance], "gateway SA carries the instance label (not its own SA name)")
}

// ADR-041 idempotency: labels + AutomountServiceAccountToken heal on
// drift. Pre-existing SA from a prior install / manual creation gets
// reconciled rather than silently accepted.
func TestApplyServiceAccount_HealsLabelDrift(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"claude-code": agentCM()},
		cm,
	)
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

	require.NoError(t, r.ensureServiceAccount(t.Context(), "my-instance", cm))

	got, err := client.CoreV1().ServiceAccounts(testConfig.Namespace).Get(t.Context(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-instance", got.Labels[LabelInstance], "instance label must be reconciled onto a pre-existing SA")
	assert.Equal(t, "stays", got.Labels["unrelated"], "unrelated labels from other controllers must be preserved")
	require.NotNil(t, got.AutomountServiceAccountToken)
	assert.False(t, *got.AutomountServiceAccountToken)
	require.Len(t, got.OwnerReferences, 1)
	assert.Equal(t, cm.UID, got.OwnerReferences[0].UID)
}

// testConfig and testOwnerCM are reused across reconciler tests; declared
// in resources_test.go.
