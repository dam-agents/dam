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

func TestWarmPool_JSONRoundTrip(t *testing.T) {
	in := WarmPool{
		Enabled:             true,
		StorageClass:        "platform-rwx-immediate",
		ReplenishInterval:   Duration(30 * 1_000_000_000),      // 30s
		MaxProvisioningTime: Duration(30 * 60 * 1_000_000_000), // 30m
		Sizes:               []WarmPoolSize{{Size: "10Gi", Target: 3}, {Size: "5Gi", Target: 1}},
	}
	data, err := json.Marshal(in)
	require.NoError(t, err)

	var out WarmPool
	require.NoError(t, json.Unmarshal(data, &out))
	assert.True(t, out.Enabled)
	assert.Equal(t, "platform-rwx-immediate", out.StorageClass)
	assert.Equal(t, "30s", out.ReplenishInterval.AsDuration().String())
	assert.Equal(t, "30m0s", out.MaxProvisioningTime.AsDuration().String())
	require.Len(t, out.Sizes, 2)
	assert.Equal(t, "10Gi", out.Sizes[0].Size)
	assert.Equal(t, 3, out.Sizes[0].Target)
}

func TestWarmPool_Validate(t *testing.T) {
	valid := func() WarmPool {
		return WarmPool{
			Enabled:      true,
			StorageClass: "platform-rwx-immediate",
			Sizes:        []WarmPoolSize{{Size: "10Gi", Target: 3}},
		}
	}

	t.Run("disabled skips all checks", func(t *testing.T) {
		w := WarmPool{Enabled: false} // empty everything
		assert.NoError(t, w.validate())
	})
	t.Run("valid passes", func(t *testing.T) {
		w := valid()
		assert.NoError(t, w.validate())
	})
	t.Run("rejects empty storage class", func(t *testing.T) {
		w := valid()
		w.StorageClass = ""
		assert.Error(t, w.validate())
	})
	t.Run("rejects empty sizes", func(t *testing.T) {
		w := valid()
		w.Sizes = nil
		assert.Error(t, w.validate())
	})
	t.Run("rejects invalid quantity", func(t *testing.T) {
		w := valid()
		w.Sizes = []WarmPoolSize{{Size: "not-a-size", Target: 1}}
		assert.Error(t, w.validate())
	})
	t.Run("rejects negative target", func(t *testing.T) {
		w := valid()
		w.Sizes = []WarmPoolSize{{Size: "10Gi", Target: -1}}
		assert.Error(t, w.validate())
	})
	t.Run("rejects duplicate canonical sizes", func(t *testing.T) {
		w := valid()
		// 5Gi and 5120Mi canonicalize to the same quantity.
		w.Sizes = []WarmPoolSize{{Size: "5Gi", Target: 1}, {Size: "5120Mi", Target: 2}}
		assert.Error(t, w.validate())
	})
}
