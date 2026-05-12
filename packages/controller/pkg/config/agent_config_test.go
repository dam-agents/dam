package config

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

// AgentBase + AgentTemplateDefaults round-trip the JSON shape Helm ships
// through AGENT_BASE / AGENT_TEMPLATE_DEFAULTS env vars. The unit tests in
// config_test.go cover LoadFromEnv end-to-end; this file just guards the
// raw shape so a typo in struct tags fails loud at compile or test time.

func TestAgentBase_JSONRoundTrip(t *testing.T) {
	in := AgentBase{
		ImagePullSecrets:       []string{"regcred"},
		StorageClass:           "platform-rwx",
		AccessMode:             "ReadWriteMany",
		IdleTimeout:            Duration(3600 * 1_000_000_000), // 1h
		TerminationGracePeriod: 5,
		RuntimeClassName:       "kata",
		ContainerSecurityContext: &corev1.SecurityContext{
			Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
		},
	}
	data, err := json.Marshal(in)
	require.NoError(t, err)

	var out AgentBase
	require.NoError(t, json.Unmarshal(data, &out))
	assert.Equal(t, in.ImagePullSecrets, out.ImagePullSecrets)
	assert.Equal(t, "platform-rwx", out.StorageClass)
	assert.Equal(t, "ReadWriteMany", out.AccessMode)
	assert.Equal(t, "1h0m0s", out.IdleTimeout.AsDuration().String())
	assert.Equal(t, int64(5), out.TerminationGracePeriod)
	assert.Equal(t, "kata", out.RuntimeClassName)
	require.NotNil(t, out.ContainerSecurityContext)
	assert.Equal(t, []corev1.Capability{"ALL"}, out.ContainerSecurityContext.Capabilities.Drop)
}

func TestAgentTemplateDefaults_JSONRoundTrip(t *testing.T) {
	in := AgentTemplateDefaults{
		AgentHome:       "/home/agent",
		ImagePullPolicy: "IfNotPresent",
		StorageSize:     "10Gi",
		Mounts: []Mount{
			{Path: "$HOME", Persist: true},
			{Path: "/tmp", Persist: false},
		},
		Env: []EnvVar{
			{Name: "PORT", Value: "8080"},
		},
	}
	data, err := json.Marshal(in)
	require.NoError(t, err)

	var out AgentTemplateDefaults
	require.NoError(t, json.Unmarshal(data, &out))
	assert.Equal(t, "/home/agent", out.AgentHome)
	assert.Equal(t, "IfNotPresent", out.ImagePullPolicy)
	assert.Equal(t, "10Gi", out.StorageSize)
	require.Len(t, out.Mounts, 2)
	assert.Equal(t, "$HOME", out.Mounts[0].Path)
	assert.True(t, out.Mounts[0].Persist)
	require.Len(t, out.Env, 1)
	assert.Equal(t, "PORT", out.Env[0].Name)
}
