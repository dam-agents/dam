package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/types"
)

var testForkOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "fork-abc",
		Namespace: "test-agents",
		UID:       "fork-uid-123",
	},
}

var testForkSpec = &types.ForkSpec{
	AgentName:  "my-agent",
	ForeignSub: "kc|user-42",
	SessionID:  "sess-1",
}

func TestBuildForkAgentJob_BasicShape(t *testing.T) {
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, testConfig, configMapOwnerRef(testForkOwnerCM), nil, "")

	require.NotNil(t, job)
	assert.Equal(t, "fork-abc", job.Name)
	assert.Equal(t, "test-agents", job.Namespace)
	assert.Equal(t, "agent-fork-job", job.Labels["agent-platform.ai/type"])
	assert.Equal(t, "fork-abc", job.Labels["agent-platform.ai/fork-id"])
	// `agent` label references the parent — for resolver / ext_authz
	// identity. `pair` is the fork's own name — for NetworkPolicy
	// scoping.
	assert.Equal(t, "my-agent", job.Labels["agent-platform.ai/agent"])
	assert.Equal(t, "fork-abc", job.Labels["agent-platform.ai/pair"])
	assert.Equal(t, "agent", job.Labels["agent-platform.ai/role"])
	// Fork agent pod opts out of ambient — same rationale as the long-lived
	// agent (kernel NP is the egress boundary).
	assert.Equal(t, "none", job.Spec.Template.Labels["istio.io/dataplane-mode"],
		"fork agent pod must carry istio.io/dataplane-mode=none")

	require.Len(t, job.OwnerReferences, 1)
	assert.Equal(t, "fork-uid-123", string(job.OwnerReferences[0].UID))
	assert.True(t, *job.OwnerReferences[0].Controller)
}

func TestBuildForkAgentJob_ProbesDisabled(t *testing.T) {
	cfg := *testConfig
	cfg.AgentProbesEnabled = false
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, &cfg, configMapOwnerRef(testForkOwnerCM), nil, "")

	c := job.Spec.Template.Spec.Containers[0]
	assert.Nil(t, c.StartupProbe)
	assert.Nil(t, c.ReadinessProbe)
	assert.Nil(t, c.LivenessProbe)
}

func TestBuildForkAgentJob_LifecycleGuarantees(t *testing.T) {
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, testConfig, configMapOwnerRef(testForkOwnerCM), nil, "")

	require.NotNil(t, job.Spec.BackoffLimit)
	assert.Equal(t, int32(0), *job.Spec.BackoffLimit)

	require.NotNil(t, job.Spec.TTLSecondsAfterFinished)
	assert.Equal(t, int32(60), *job.Spec.TTLSecondsAfterFinished)

	assert.Equal(t, corev1.RestartPolicyNever, job.Spec.Template.Spec.RestartPolicy)
}

func TestBuildForkAgentJob_ForkMetadataEnv(t *testing.T) {
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, testConfig, configMapOwnerRef(testForkOwnerCM), nil, "10.96.42.42")
	c := job.Spec.Template.Spec.Containers[0]

	env := envMap(c.Env)
	assert.Equal(t, "fork-abc", env["PLATFORM_FORK_ID"])
	assert.Equal(t, "kc|user-42", env["PLATFORM_FOREIGN_SUB"])
	assert.Equal(t, "my-agent", env["PLATFORM_AGENT_ID"])
	// HTTPS_PROXY is IP-direct — the fork's OWN gateway ClusterIP, not
	// the parent's. The fork reconciler passes its own gateway IP.
	assert.Equal(t, "http://10.96.42.42:10000", env["HTTPS_PROXY"])
}

func TestBuildForkAgentJob_MountsAgentPVC_NotVolumeClaimTemplate(t *testing.T) {
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, testConfig, configMapOwnerRef(testForkOwnerCM), nil, "")

	podSpec := job.Spec.Template.Spec

	var persistentVol *corev1.Volume
	for i := range podSpec.Volumes {
		if podSpec.Volumes[i].Name == "home-agent" {
			persistentVol = &podSpec.Volumes[i]
			break
		}
	}
	require.NotNil(t, persistentVol, "home-agent volume missing")
	require.NotNil(t, persistentVol.PersistentVolumeClaim, "home-agent volume must reference an existing PVC")
	assert.Equal(t, "home-agent-my-agent-0", persistentVol.PersistentVolumeClaim.ClaimName)
	assert.Nil(t, persistentVol.EmptyDir)
}

// The fork inherits secretRef via the AgentSpec; user env (spec.env) is not — it rides the runtime channel.
func TestBuildForkAgentJob_InheritsAgentSecretRefNotEnv(t *testing.T) {
	agent := *testAgent
	agent.Env = append([]types.EnvVar{{Name: "FOO", Value: "bar"}}, testAgent.Env...)
	agent.SecretRef = "my-extra-secret"

	job := BuildForkAgentJob("fork-abc", testForkSpec, &agent, testConfig, configMapOwnerRef(testForkOwnerCM), nil, "")
	c := job.Spec.Template.Spec.Containers[0]

	_, hasFOO := envMap(c.Env)["FOO"]
	assert.False(t, hasFOO, "spec.env must not be projected into the fork — user env rides the rail")
	require.Len(t, c.EnvFrom, 1)
	require.NotNil(t, c.EnvFrom[0].SecretRef)
	assert.Equal(t, "my-extra-secret", c.EnvFrom[0].SecretRef.Name)
}

func envMap(envs []corev1.EnvVar) map[string]string {
	m := map[string]string{}
	for _, e := range envs {
		m[e.Name] = e.Value
	}
	return m
}

func TestBuildForkAgentJob_NoSidecar(t *testing.T) {
	// Agent and gateway are paired pods, not co-located. Fork
	// agents have only one container.
	secrets := []corev1.Secret{credSecret("platform-cred-replier-x", "api.example.com")}
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, testConfig, configMapOwnerRef(testForkOwnerCM), secrets, "10.96.42.42")

	require.Len(t, job.Spec.Template.Spec.Containers, 1, "fork agent has no sidecar")
	agent := job.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "agent", agent.Name)

	envM := envMap(agent.Env)
	assert.Equal(t, "http://10.96.42.42:10000", envM["HTTP_PROXY"])
	assert.Equal(t, "http://10.96.42.42:10000", envM["HTTPS_PROXY"])

	require.NotNil(t, job.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *job.Spec.Template.Spec.AutomountServiceAccountToken)
	require.NotNil(t, job.Spec.Template.Spec.ShareProcessNamespace)
	assert.False(t, *job.Spec.Template.Spec.ShareProcessNamespace)
}

func TestBuildForkAgentJob_NoCredentialMountsOnAgent(t *testing.T) {
	// Replier credentials live on the paired fork gateway pod only.
	secrets := []corev1.Secret{credSecret("platform-cred-replier-x", "api.example.com")}
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, testConfig, configMapOwnerRef(testForkOwnerCM), secrets, "")

	for _, v := range job.Spec.Template.Spec.Volumes {
		assert.NotContains(t, v.Name, "cred-platform-cred-",
			"fork agent pod must not mount credential Secrets")
		assert.NotEqual(t, "envoy-bootstrap", v.Name,
			"fork agent must not mount the Envoy bootstrap CM")
		assert.NotEqual(t, "envoy-tls", v.Name,
			"fork agent must not mount the leaf TLS Secret with the private key")
	}

	for _, m := range job.Spec.Template.Spec.Containers[0].VolumeMounts {
		assert.NotContains(t, m.Name, "cred-platform-cred-",
			"credential boundary lives at the pod boundary — fork agent never sees Secret bytes")
	}
}

func TestBuildForkAgentJob_NoFetchCACertInit(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-replier-x", "api.example.com")}
	job := BuildForkAgentJob("fork-abc", testForkSpec, testAgent, testConfig, configMapOwnerRef(testForkOwnerCM), secrets, "")

	for _, ic := range job.Spec.Template.Spec.InitContainers {
		assert.NotEqual(t, "fetch-ca-cert", ic.Name, "no fetch-ca-cert init container")
	}

	var caVol *corev1.Volume
	for i := range job.Spec.Template.Spec.Volumes {
		if job.Spec.Template.Spec.Volumes[i].Name == "ca-cert" {
			caVol = &job.Spec.Template.Spec.Volumes[i]
			break
		}
	}
	require.NotNil(t, caVol)
	require.NotNil(t, caVol.Secret)
	assert.Equal(t, EnvoyLeafSecretName("fork-abc"), caVol.Secret.SecretName)
	require.Len(t, caVol.Secret.Items, 1)
	assert.Equal(t, "ca.crt", caVol.Secret.Items[0].Key,
		"fork agent must only see ca.crt — never tls.key")
}
