package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/humr/packages/controller/pkg/types"
)

var testForkOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "fork-abc",
		Namespace: "test-agents",
		UID:       "fork-uid-123",
	},
}

var testForkSpec = &types.ForkSpec{
	Version:             types.SpecVersion,
	Instance:            "my-instance",
	ForeignSub:          "kc|user-42",
	ForkAgentIdentifier: "fork-my-instance-aaaabbbbcccc",
	SessionID:           "sess-1",
	AccessToken:         "onecli-foreign-token",
}

var testForkInstance = &types.InstanceSpec{
	Version:      types.SpecVersion,
	DesiredState: "running",
	AgentName:    "my-agent",
	Env:          []types.EnvVar{{Name: "GITHUB_ORG", Value: "alpha"}},
}

func TestBuildForkJob_BasicShape(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil, nil)

	require.NotNil(t, job)
	assert.Equal(t, "fork-abc", job.Name)
	assert.Equal(t, "test-agents", job.Namespace)
	assert.Equal(t, "agent-fork-job", job.Labels["humr.ai/type"])
	assert.Equal(t, "fork-abc", job.Labels["humr.ai/fork-id"])
	assert.Equal(t, "my-instance", job.Labels["humr.ai/instance"])

	require.Len(t, job.OwnerReferences, 1)
	assert.Equal(t, "fork-uid-123", string(job.OwnerReferences[0].UID))
	assert.True(t, *job.OwnerReferences[0].Controller)
}

func TestBuildForkJob_LifecycleGuarantees(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil, nil)

	require.NotNil(t, job.Spec.BackoffLimit)
	assert.Equal(t, int32(0), *job.Spec.BackoffLimit)

	require.NotNil(t, job.Spec.TTLSecondsAfterFinished)
	assert.Equal(t, int32(60), *job.Spec.TTLSecondsAfterFinished)

	assert.Equal(t, corev1.RestartPolicyNever, job.Spec.Template.Spec.RestartPolicy)
}

func TestBuildForkJob_ForeignTokenInlined(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil, nil)

	require.Len(t, job.Spec.Template.Spec.Containers, 1)
	c := job.Spec.Template.Spec.Containers[0]

	var tokenEnv *corev1.EnvVar
	for i := range c.Env {
		if c.Env[i].Name == "ONECLI_ACCESS_TOKEN" {
			tokenEnv = &c.Env[i]
			break
		}
	}
	require.NotNil(t, tokenEnv, "ONECLI_ACCESS_TOKEN missing from fork env")
	assert.Equal(t, "onecli-foreign-token", tokenEnv.Value)
	assert.Nil(t, tokenEnv.ValueFrom, "fork token must be inlined, not SecretKeyRef")
}

func TestBuildForkJob_ForkMetadataEnv(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil, nil)
	c := job.Spec.Template.Spec.Containers[0]

	env := envMap(c.Env)
	assert.Equal(t, "fork-abc", env["HUMR_FORK_ID"])
	assert.Equal(t, "kc|user-42", env["HUMR_FOREIGN_SUB"])
	assert.Equal(t, "my-instance", env["ADK_INSTANCE_ID"])
}

func TestBuildForkJob_MountsInstancePVC_NotVolumeClaimTemplate(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil, nil)

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

func TestBuildForkJob_CACertInitContainer(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil, nil)

	initNames := make([]string, 0, len(job.Spec.Template.Spec.InitContainers))
	for _, ic := range job.Spec.Template.Spec.InitContainers {
		initNames = append(initNames, ic.Name)
	}
	assert.Contains(t, initNames, "fetch-ca-cert")
}

func TestBuildForkJob_InheritsInstanceEnvAndSecretRef(t *testing.T) {
	instance := &types.InstanceSpec{
		Version:      types.SpecVersion,
		DesiredState: "running",
		Env:          []types.EnvVar{{Name: "FOO", Value: "bar"}},
		SecretRef:    "my-extra-secret",
	}
	job := BuildForkJob("fork-abc", testForkSpec, instance, testAgent, testConfig, testForkOwnerCM, nil, nil)
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

// --- Experimental credential injector (Envoy sidecar) path ---

// On the Envoy fork path the api-server skips the OneCLI mint, so the spec
// arrives without `accessToken` / `forkAgentIdentifier`. The controller
// resolves credentials from foreignSub-labelled K8s Secrets at render time.
var testForkSpecEnvoy = &types.ForkSpec{
	Version:    types.SpecVersion,
	Instance:   "my-instance",
	ForeignSub: "kc|user-42",
	SessionID:  "sess-1",
}

var testForkInstanceFlagOn = &types.InstanceSpec{
	Version:                        types.SpecVersion,
	DesiredState:                   "running",
	AgentName:                      "my-agent",
	ExperimentalCredentialInjector: true,
}

func TestBuildForkJob_FlagOn_AddsEnvoySidecar(t *testing.T) {
	secrets := []corev1.Secret{credSecret("humr-cred-replier-x", "api.example.com")}
	job := BuildForkJob("fork-abc", testForkSpecEnvoy, testForkInstanceFlagOn, testAgent, testEnvoyConfig, testForkOwnerCM, nil, secrets)

	require.Len(t, job.Spec.Template.Spec.Containers, 2, "agent + envoy sidecar")
	agent := job.Spec.Template.Spec.Containers[0]
	envoy := job.Spec.Template.Spec.Containers[1]
	assert.Equal(t, "agent", agent.Name)
	assert.Equal(t, "envoy", envoy.Name)
	assert.Equal(t, "envoyproxy/envoy:distroless-v1.37.2", envoy.Image)

	envM := envMap(agent.Env)
	assert.Equal(t, "http://127.0.0.1:10000", envM["HTTP_PROXY"])
	assert.Equal(t, "http://127.0.0.1:10000", envM["HTTPS_PROXY"])
	assert.NotContains(t, envM, "ONECLI_ACCESS_TOKEN", "fork on Envoy path must not see the OneCLI sentinel")

	// Pod-level threat-model wiring matches the parent's flag-on path.
	require.NotNil(t, job.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *job.Spec.Template.Spec.AutomountServiceAccountToken)
	require.NotNil(t, job.Spec.Template.Spec.ShareProcessNamespace)
	assert.False(t, *job.Spec.Template.Spec.ShareProcessNamespace)
}

func TestBuildForkJob_FlagOn_ReplierSecretsMountedSidecarOnly(t *testing.T) {
	secrets := []corev1.Secret{credSecret("humr-cred-replier-x", "api.example.com")}
	job := BuildForkJob("fork-abc", testForkSpecEnvoy, testForkInstanceFlagOn, testAgent, testEnvoyConfig, testForkOwnerCM, nil, secrets)

	require.Len(t, job.Spec.Template.Spec.Containers, 2)
	agent := job.Spec.Template.Spec.Containers[0]
	envoy := job.Spec.Template.Spec.Containers[1]

	// Sidecar gets the credential mount...
	envoyMounts := map[string]bool{}
	for _, m := range envoy.VolumeMounts {
		envoyMounts[m.Name] = true
	}
	require.True(t, envoyMounts["cred-humr-cred-replier-x"], "envoy must mount the replier credential secret")

	// ...and the agent absolutely does not.
	for _, m := range agent.VolumeMounts {
		assert.NotEqual(t, "cred-humr-cred-replier-x", m.Name, "credential boundary lives at the container — agent must not see Secret bytes")
	}
}

func TestBuildForkJob_FlagOn_NoFetchCACertInit(t *testing.T) {
	// On the Envoy path the CA comes from a projected leaf Secret; the OneCLI
	// fetch-ca-cert init container is only relevant on the legacy path.
	secrets := []corev1.Secret{credSecret("humr-cred-replier-x", "api.example.com")}
	job := BuildForkJob("fork-abc", testForkSpecEnvoy, testForkInstanceFlagOn, testAgent, testEnvoyConfig, testForkOwnerCM, nil, secrets)

	for _, ic := range job.Spec.Template.Spec.InitContainers {
		assert.NotEqual(t, "fetch-ca-cert", ic.Name, "fetch-ca-cert is OneCLI-only — must not run on the Envoy path")
	}

	// CA volume is the projected per-fork leaf Secret.
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

func TestBuildForkJob_FlagOn_GHTokenSignal(t *testing.T) {
	cases := map[string]struct {
		secrets []corev1.Secret
		want    string
	}{
		"with github cred":    {[]corev1.Secret{credSecret("humr-cred-gh", "api.github.com")}, "true"},
		"without github cred": {[]corev1.Secret{credSecret("humr-cred-other", "api.example.com")}, "false"},
		"no creds":            {nil, "false"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			job := BuildForkJob("fork-abc", testForkSpecEnvoy, testForkInstanceFlagOn, testAgent, testEnvoyConfig, testForkOwnerCM, nil, tc.secrets)
			env := envMap(job.Spec.Template.Spec.Containers[0].Env)
			assert.Equal(t, tc.want, env["HUMR_GH_TOKEN_AVAILABLE"])
		})
	}
}

func TestBuildForkJob_FlagOff_KeepsOneCLIShape(t *testing.T) {
	// Sanity check that the legacy path is untouched: single agent container,
	// inlined ONECLI_ACCESS_TOKEN, fetch-ca-cert init container, no SA-token
	// override. Mirrors the existing fork tests but contrasts with flag-on.
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil, nil)

	require.Len(t, job.Spec.Template.Spec.Containers, 1, "no sidecar on flag-off path")
	env := envMap(job.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "onecli-foreign-token", env["ONECLI_ACCESS_TOKEN"])
	assert.Nil(t, job.Spec.Template.Spec.AutomountServiceAccountToken, "flag-off leaves SA-token automount at K8s default")
	assert.Nil(t, job.Spec.Template.Spec.ShareProcessNamespace, "flag-off leaves share-pid at K8s default")

	initNames := []string{}
	for _, ic := range job.Spec.Template.Spec.InitContainers {
		initNames = append(initNames, ic.Name)
	}
	assert.Contains(t, initNames, "fetch-ca-cert")
}
