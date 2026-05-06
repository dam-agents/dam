package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

func TestBuildInstanceServiceAccount(t *testing.T) {
	sa := BuildInstanceServiceAccount("my-instance", testConfig, testOwnerCM)

	// Name == instance name so the SPIFFE principal
	// `cluster.local/ns/<ns>/sa/my-instance` equals the URL `:id` the
	// api-server cross-checks (ADR-039).
	assert.Equal(t, "my-instance", sa.Name)
	assert.Equal(t, "test-agents", sa.Namespace)
	assert.Equal(t, "my-instance", sa.Labels["agent-platform.ai/instance"])

	require.Len(t, sa.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(sa.OwnerReferences[0].UID),
		"SA must be owner-refed to the instance CM so K8s GC reaps it on instance deletion")

	require.NotNil(t, sa.AutomountServiceAccountToken)
	assert.False(t, *sa.AutomountServiceAccountToken,
		"agent and gateway pods both opt out of SA token mounts; ambient identity is independent")
}

func TestBuildAgentStatefulSet_ServiceAccountName(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildAgentStatefulSet("my-instance", instance, testAgent, testConfig, testOwnerCM, nil)
	assert.Equal(t, "my-instance", ss.Spec.Template.Spec.ServiceAccountName,
		"agent pod runs as the per-instance SA (ADR-039)")
}

func TestBuildGatewayStatefulSet_ServiceAccountName(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", false, testConfig, testOwnerCM, nil)
	assert.Equal(t, "my-instance", ss.Spec.Template.Spec.ServiceAccountName,
		"gateway pod shares the per-instance SA so the pair speaks one identity")
}

func TestBuildForkGatewayPod_ServiceAccountName(t *testing.T) {
	pod := BuildForkGatewayPod("fork-abc", "parent-instance", testConfig, testForkOwnerCM, nil)
	assert.Equal(t, "parent-instance", pod.Spec.ServiceAccountName,
		"fork gateway runs as the parent instance's SA so peer-principal still resolves to the parent")
}
