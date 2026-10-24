package config

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentBase_JSONRoundTrip(t *testing.T) {
	in := AgentBase{
		ImagePullSecrets: []string{"regcred"},
		VMIdleTimeout:    Duration(3600 * 1_000_000_000),
	}
	data, err := json.Marshal(in)
	require.NoError(t, err)

	var out AgentBase
	require.NoError(t, json.Unmarshal(data, &out))
	assert.Equal(t, in.ImagePullSecrets, out.ImagePullSecrets)
	assert.Equal(t, "1h0m0s", out.VMIdleTimeout.AsDuration().String())
}

func TestAgentTemplateDefaults_JSONRoundTrip(t *testing.T) {
	in := AgentTemplateDefaults{
		StorageSize: "10Gi",
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
	assert.Equal(t, "10Gi", out.StorageSize)
	require.Len(t, out.Mounts, 2)
	assert.Equal(t, "$HOME", out.Mounts[0].Path)
	assert.True(t, out.Mounts[0].Persist)
	require.Len(t, out.Env, 1)
	assert.Equal(t, "PORT", out.Env[0].Name)
}
