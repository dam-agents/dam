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
	Version:    types.SpecVersion,
	Instance:   "my-instance",
	ForeignSub: "kc|user-42",
	SessionID:  "sess-1",
}

var testForkInstance = &types.InstanceSpec{
	Version:      types.SpecVersion,
	DesiredState: "running",
	AgentName:    "my-agent",
	Env:          []types.EnvVar{{Name: "GITHUB_ORG", Value: "alpha"}},
}

func TestBuildForkJob_BasicShape(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

	require.NotNil(t, job)
	assert.Equal(t, "fork-abc", job.Name)
	assert.Equal(t, "test-agents", job.Namespace)
	assert.Equal(t, "agent-fork-job", job.Labels["agent-platform.ai/type"])
	assert.Equal(t, "fork-abc", job.Labels["agent-platform.ai/fork-id"])
	assert.Equal(t, "my-instance", job.Labels["agent-platform.ai/instance"])

	require.Len(t, job.OwnerReferences, 1)
	assert.Equal(t, "fork-uid-123", string(job.OwnerReferences[0].UID))
	assert.True(t, *job.OwnerReferences[0].Controller)
}

func TestBuildForkJob_LifecycleGuarantees(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

	require.NotNil(t, job.Spec.BackoffLimit)
	assert.Equal(t, int32(0), *job.Spec.BackoffLimit)

	require.NotNil(t, job.Spec.TTLSecondsAfterFinished)
	assert.Equal(t, int32(60), *job.Spec.TTLSecondsAfterFinished)

	assert.Equal(t, corev1.RestartPolicyNever, job.Spec.Template.Spec.RestartPolicy)
}

func TestBuildForkJob_ForkMetadataEnv(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)
	c := job.Spec.Template.Spec.Containers[0]

	env := envMap(c.Env)
	assert.Equal(t, "fork-abc", env["PLATFORM_FORK_ID"])
	assert.Equal(t, "kc|user-42", env["PLATFORM_FOREIGN_SUB"])
	assert.Equal(t, "my-instance", env["ADK_INSTANCE_ID"])
	assert.Equal(t, "http://127.0.0.1:10000", env["HTTPS_PROXY"])
}

func TestBuildForkJob_MountsInstancePVC_NotVolumeClaimTemplate(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

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
	assert.Equal(t, "home-agent-my-instance-0", persistentVol.PersistentVolumeClaim.ClaimName)
	assert.Nil(t, persistentVol.EmptyDir)
}

func TestBuildForkJob_InheritsInstanceEnvAndSecretRef(t *testing.T) {
	instance := &types.InstanceSpec{
		Version:      types.SpecVersion,
		DesiredState: "running",
		Env:          []types.EnvVar{{Name: "FOO", Value: "bar"}},
		SecretRef:    "my-extra-secret",
	}
	job := BuildForkJob("fork-abc", testForkSpec, instance, testAgent, testConfig, testForkOwnerCM, nil)
	c := job.Spec.Template.Spec.Containers[0]

	assert.Equal(t, "bar", envMap(c.Env)["FOO"])
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

func TestBuildForkJob_AddsEnvoySidecar(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-replier-x", "api.example.com")}
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, secrets)

	require.Len(t, job.Spec.Template.Spec.Containers, 2, "agent + envoy sidecar")
	agent := job.Spec.Template.Spec.Containers[0]
	envoy := job.Spec.Template.Spec.Containers[1]
	assert.Equal(t, "agent", agent.Name)
	assert.Equal(t, "envoy", envoy.Name)
	assert.Equal(t, "envoyproxy/envoy:distroless-v1.37.2", envoy.Image)

	envM := envMap(agent.Env)
	assert.Equal(t, "http://127.0.0.1:10000", envM["HTTP_PROXY"])
	assert.Equal(t, "http://127.0.0.1:10000", envM["HTTPS_PROXY"])

	require.NotNil(t, job.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *job.Spec.Template.Spec.AutomountServiceAccountToken)
	require.NotNil(t, job.Spec.Template.Spec.ShareProcessNamespace)
	assert.False(t, *job.Spec.Template.Spec.ShareProcessNamespace)
}

func TestBuildForkJob_ReplierSecretsMountedSidecarOnly(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-replier-x", "api.example.com")}
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, secrets)

	require.Len(t, job.Spec.Template.Spec.Containers, 2)
	agent := job.Spec.Template.Spec.Containers[0]
	envoy := job.Spec.Template.Spec.Containers[1]

	envoyMounts := map[string]bool{}
	for _, m := range envoy.VolumeMounts {
		envoyMounts[m.Name] = true
	}
	require.True(t, envoyMounts["cred-platform-cred-replier-x"], "envoy must mount the replier credential secret")

	for _, m := range agent.VolumeMounts {
		assert.NotEqual(t, "cred-platform-cred-replier-x", m.Name, "credential boundary lives at the container — agent must not see Secret bytes")
	}
}

func TestBuildForkJob_NoFetchCACertInit(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-replier-x", "api.example.com")}
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, secrets)

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
}

func TestBuildForkJob_GHTokenSignal(t *testing.T) {
	cases := map[string]struct {
		secrets []corev1.Secret
		want    string
	}{
		"with github cred":    {[]corev1.Secret{credSecret("platform-cred-gh", "api.github.com")}, "true"},
		"without github cred": {[]corev1.Secret{credSecret("platform-cred-other", "api.example.com")}, "false"},
		"no creds":            {nil, "false"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, tc.secrets)
			env := envMap(job.Spec.Template.Spec.Containers[0].Env)
			assert.Equal(t, tc.want, env["PLATFORM_GH_TOKEN_AVAILABLE"])
		})
	}
}
