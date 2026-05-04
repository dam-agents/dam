package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/onecli"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

var testConfig = &config.Config{
	Namespace:        "test-agents",
	ReleaseNamespace: "default",
	ReleaseName:      "humr",
	GatewayHost:      "humr-onecli",
	GatewayPort:      10255,
	WebPort:          10254,
	CACertInitImage:  "busybox:stable",
	HarnessServerPort:    4001,
	AgentHome:        "/home/agent",
}

var testAgent = &types.AgentSpec{
	Image: "ghcr.io/myorg/agent:latest",
	Mounts: []types.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/tmp", Persist: false},
	},
	Init: "#!/bin/bash\necho hello",
	Env:  []types.EnvVar{{Name: "ACP_PORT", Value: "8080"}},
	Resources: types.ResourceSpec{
		Requests: map[string]string{"cpu": "250m", "memory": "512Mi"},
		Limits:   map[string]string{"cpu": "1", "memory": "2Gi"},
	},
	SecurityContext: &types.SecurityContext{
		RunAsNonRoot:           boolPtr(true),
		ReadOnlyRootFilesystem: boolPtr(false),
	},
}

var testOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "my-instance",
		Namespace: "test-agents",
		UID:       "cm-uid-123",
	},
}

func boolPtr(b bool) *bool { return &b }

// --- StatefulSet tests ---

func TestBuildStatefulSet_Running(t *testing.T) {
	instance := &types.InstanceSpec{
		DesiredState: "running",
		Env:          []types.EnvVar{{Name: "GITHUB_ORG", Value: "alpha"}},
		SecretRef:    "my-secrets",
	}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testConfig, "my-agent", testOwnerCM, nil, nil)

	require.NotNil(t, ss)
	assert.Equal(t, "my-instance", ss.Name)
	assert.Equal(t, "test-agents", ss.Namespace)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	// Owner reference
	require.Len(t, ss.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(ss.OwnerReferences[0].UID))

	// Labels
	assert.Equal(t, "my-instance", ss.Spec.Template.Labels["humr.ai/instance"])

	// Container
	require.Len(t, ss.Spec.Template.Spec.Containers, 1)
	c := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "ghcr.io/myorg/agent:latest", c.Image)
	assert.Equal(t, int32(8080), c.Ports[0].ContainerPort)
	assert.Equal(t, "acp", c.Ports[0].Name)

	// Probes
	assert.Equal(t, "/healthz", c.StartupProbe.HTTPGet.Path)
	assert.Equal(t, int32(1), c.StartupProbe.PeriodSeconds)
	assert.Equal(t, int32(120), c.StartupProbe.FailureThreshold)
	assert.Equal(t, "/healthz", c.ReadinessProbe.HTTPGet.Path)
	assert.Equal(t, int32(10), c.ReadinessProbe.PeriodSeconds)
	assert.Equal(t, "/healthz", c.LivenessProbe.HTTPGet.Path)
	assert.Equal(t, int32(10), c.LivenessProbe.PeriodSeconds)

	// Platform env vars
	envMap := envToMap(c.Env)
	assert.Equal(t, "http://x:$(ONECLI_ACCESS_TOKEN)@humr-onecli.default.svc.cluster.local:10255", envMap["HTTPS_PROXY"])
	assert.Equal(t, "http://x:$(ONECLI_ACCESS_TOKEN)@humr-onecli.default.svc.cluster.local:10255", envMap["HTTP_PROXY"])

	// ONECLI_ACCESS_TOKEN comes from Secret via secretKeyRef
	tokenEnv := c.Env[0]
	assert.Equal(t, "ONECLI_ACCESS_TOKEN", tokenEnv.Name)
	assert.Equal(t, "humr-agent-my-agent-token", tokenEnv.ValueFrom.SecretKeyRef.Name)
	assert.Equal(t, "access-token", tokenEnv.ValueFrom.SecretKeyRef.Key)
	assert.Equal(t, "/etc/humr/ca/ca.crt", envMap["SSL_CERT_FILE"])
	assert.Equal(t, "/etc/humr/ca/ca.crt", envMap["NODE_EXTRA_CA_CERTS"])
	assert.Equal(t, "my-instance", envMap["ADK_INSTANCE_ID"])
	// Template env
	assert.Equal(t, "8080", envMap["ACP_PORT"])
	// Instance env
	assert.Equal(t, "alpha", envMap["GITHUB_ORG"])

	// EnvFrom secretRef
	require.Len(t, c.EnvFrom, 1)
	assert.Equal(t, "my-secrets", c.EnvFrom[0].SecretRef.LocalObjectReference.Name)

	// Resources
	assert.Equal(t, resource.MustParse("250m"), *c.Resources.Requests.Cpu())
	assert.Equal(t, resource.MustParse("2Gi"), *c.Resources.Limits.Memory())

	// Security context
	assert.True(t, *ss.Spec.Template.Spec.SecurityContext.RunAsNonRoot)
}

func TestBuildStatefulSet_Hibernated(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "hibernated"}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testConfig, "my-agent", testOwnerCM, nil, nil)
	assert.Equal(t, int32(0), *ss.Spec.Replicas)
}

func TestBuildStatefulSet_InitContainer(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testConfig, "my-agent", testOwnerCM, nil, nil)
	require.Len(t, ss.Spec.Template.Spec.InitContainers, 2)

	// First: platform CA cert fetcher (busybox — no dependency on agent image)
	caIC := ss.Spec.Template.Spec.InitContainers[0]
	assert.Equal(t, "fetch-ca-cert", caIC.Name)
	assert.Equal(t, "busybox:stable", caIC.Image)
	require.Len(t, caIC.VolumeMounts, 1)
	assert.Equal(t, "/etc/humr/ca", caIC.VolumeMounts[0].MountPath)

	// Second: user-defined init
	ic := ss.Spec.Template.Spec.InitContainers[1]
	assert.Equal(t, "ghcr.io/myorg/agent:latest", ic.Image)
	assert.Equal(t, []string{"sh", "-c", testAgent.Init}, ic.Command)
}

func TestBuildStatefulSet_NoUserInitWhenEmpty(t *testing.T) {
	agent := *testAgent
	agent.Init = ""
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, &agent, testConfig, "my-agent", testOwnerCM, nil, nil)
	// CA cert init container is always present
	require.Len(t, ss.Spec.Template.Spec.InitContainers, 1)
	assert.Equal(t, "fetch-ca-cert", ss.Spec.Template.Spec.InitContainers[0].Name)
}

func TestBuildStatefulSet_Volumes(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testConfig, "my-agent", testOwnerCM, nil, nil)

	// 1 PVC (home-agent)
	require.Len(t, ss.Spec.VolumeClaimTemplates, 1)
	pvc := ss.Spec.VolumeClaimTemplates[0]
	assert.Equal(t, "home-agent", pvc.Name)
	assert.Equal(t, []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany}, pvc.Spec.AccessModes)
	assert.Nil(t, pvc.Spec.StorageClassName, "unset AgentStorageClass → PVC gets cluster-default class")

	// EmptyDir for /tmp + emptyDir for CA cert
	volMap := make(map[string]corev1.Volume)
	for _, v := range ss.Spec.Template.Spec.Volumes {
		volMap[v.Name] = v
	}
	assert.NotNil(t, volMap["tmp"].EmptyDir)
	assert.NotNil(t, volMap["ca-cert"].EmptyDir)

	// Volume mounts on container
	c := ss.Spec.Template.Spec.Containers[0]
	mountPaths := make(map[string]string)
	for _, m := range c.VolumeMounts {
		mountPaths[m.MountPath] = m.Name
	}
	assert.Equal(t, "home-agent", mountPaths["/home/agent"])
	assert.Equal(t, "tmp", mountPaths["/tmp"])
	assert.Equal(t, "ca-cert", mountPaths["/etc/humr/ca"])
}

func TestBuildStatefulSet_PVCSize(t *testing.T) {
	// Mount with explicit size renders a PVC sized accordingly; mount without
	// size falls back to the historical 10Gi default. (issue #244)
	agent := types.AgentSpec{
		Image: "humr-test:latest",
		Mounts: []types.Mount{
			{Path: "/home/agent", Persist: true, Size: "2Gi"},
			{Path: "/cache", Persist: true},
		},
	}
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, &agent, testConfig, "my-agent", testOwnerCM, nil, nil)

	require.Len(t, ss.Spec.VolumeClaimTemplates, 2)
	byName := map[string]corev1.PersistentVolumeClaim{}
	for _, pvc := range ss.Spec.VolumeClaimTemplates {
		byName[pvc.Name] = pvc
	}
	home := byName["home-agent"].Spec.Resources.Requests[corev1.ResourceStorage]
	cache := byName["cache"].Spec.Resources.Requests[corev1.ResourceStorage]
	assert.Equal(t, "2Gi", home.String())
	assert.Equal(t, "10Gi", cache.String())
}

func TestBuildStatefulSet_AgentStorageClass(t *testing.T) {
	cfg := *testConfig
	cfg.AgentStorageClass = "humr-rwx"
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testAgent, &cfg, "my-agent", testOwnerCM, nil, nil)

	require.Len(t, ss.Spec.VolumeClaimTemplates, 1)
	pvc := ss.Spec.VolumeClaimTemplates[0]
	require.NotNil(t, pvc.Spec.StorageClassName)
	assert.Equal(t, "humr-rwx", *pvc.Spec.StorageClassName)
}

func TestBuildStatefulSet_ConnectorEnvs(t *testing.T) {
	instance := &types.InstanceSpec{
		DesiredState: "running",
		// Instance-level override for GH_TOKEN must win over the connector's value.
		Env: []types.EnvVar{{Name: "GH_TOKEN", Value: "override"}},
	}
	connectorEnvs := []corev1.EnvVar{
		{Name: "GH_TOKEN", Value: onecli.DefaultEnvPlaceholder},
		{Name: "CLAUDE_CODE_OAUTH_TOKEN", Value: onecli.DefaultEnvPlaceholder},
	}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testConfig, "my-agent", testOwnerCM, connectorEnvs, nil)

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, onecli.DefaultEnvPlaceholder, envMap["CLAUDE_CODE_OAUTH_TOKEN"])
	// K8s takes the last EnvVar with a given name; instance env is appended
	// after connector env so user override wins.
	assert.Equal(t, "override", envMap["GH_TOKEN"])
}

// Pod-files are materialized in-process by agent-runtime. The reconciler's
// only job is to set HUMR_POD_FILES_EVENTS_URL on the agent container so the
// runtime knows where to subscribe. No sidecar, no shared emptyDir — the
// runtime writes directly under HOME on the PVC, so image-baked content can
// participate in the merge.
func TestBuildStatefulSet_PodFilesEventsURL(t *testing.T) {
	cfg := *testConfig
	cfg.HarnessServerURL = "http://humr-apiserver.default.svc:4001"
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testAgent, &cfg, "my-agent", testOwnerCM, nil, nil)

	// Single container: just the agent. No sidecar.
	require.Len(t, ss.Spec.Template.Spec.Containers, 1)
	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t,
		"http://humr-apiserver.default.svc:4001/api/instances/my-instance/pod-files/events",
		envMap["HUMR_POD_FILES_EVENTS_URL"])

	// No gh-config volume / mount anywhere.
	for _, v := range ss.Spec.Template.Spec.Volumes {
		assert.NotEqual(t, "gh-config", v.Name, "gh-config emptyDir must not be set anymore")
	}
	for _, m := range ss.Spec.Template.Spec.Containers[0].VolumeMounts {
		assert.NotEqual(t, "gh-config", m.Name, "gh-config mount must not be set anymore")
	}
}

func TestBuildStatefulSet_NoSecretRef(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testConfig, "my-agent", testOwnerCM, nil, nil)
	assert.Empty(t, ss.Spec.Template.Spec.Containers[0].EnvFrom)
}

// --- Service tests ---

func TestBuildService(t *testing.T) {
	svc := BuildService("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "my-instance", svc.Name)
	assert.Equal(t, "test-agents", svc.Namespace)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)
	assert.Equal(t, int32(8080), svc.Spec.Ports[0].Port)
	assert.Equal(t, "acp", svc.Spec.Ports[0].Name)
	assert.Equal(t, "my-instance", svc.Spec.Selector["humr.ai/instance"])
	require.Len(t, svc.OwnerReferences, 1)
}

// --- NetworkPolicy tests ---

func TestBuildNetworkPolicy(t *testing.T) {
	np := BuildNetworkPolicy("my-instance", testConfig, testOwnerCM, &types.InstanceSpec{DesiredState: "running"})
	assert.Equal(t, "my-instance-egress", np.Name)
	assert.Equal(t, "test-agents", np.Namespace)
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels["humr.ai/instance"])
	require.Len(t, np.OwnerReferences, 1)

	require.Len(t, np.Spec.Egress, 3)

	// OneCLI rule targets OneCLI pods in the release namespace (gateway + web ports)
	onecliRule := np.Spec.Egress[0]
	require.Len(t, onecliRule.To, 1)
	assert.Equal(t, "onecli", onecliRule.To[0].PodSelector.MatchLabels["app.kubernetes.io/component"])
	require.NotNil(t, onecliRule.To[0].NamespaceSelector, "OneCLI egress rule must include namespaceSelector for cross-namespace access")
	assert.Equal(t, "default", onecliRule.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
	require.Len(t, onecliRule.Ports, 2, "should allow both gateway and web ports")
	assert.Equal(t, int32(10255), onecliRule.Ports[0].Port.IntVal)
	assert.Equal(t, int32(10254), onecliRule.Ports[1].Port.IntVal)

	mcpRule := np.Spec.Egress[1]
	require.Len(t, mcpRule.To, 1)
	assert.Equal(t, "apiserver", mcpRule.To[0].PodSelector.MatchLabels["app.kubernetes.io/component"])
	require.NotNil(t, mcpRule.To[0].NamespaceSelector, "API Server egress rule must include namespaceSelector for cross-namespace access")
	assert.Equal(t, "default", mcpRule.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
	require.Len(t, mcpRule.Ports, 1)
	assert.Equal(t, int32(4001), mcpRule.Ports[0].Port.IntVal)

	// Ingress: allow ACP port
	require.Len(t, np.Spec.Ingress, 1)
	assert.Equal(t, int32(8080), np.Spec.Ingress[0].Ports[0].Port.IntVal)
}

func envToMap(envs []corev1.EnvVar) map[string]string {
	m := make(map[string]string)
	for _, e := range envs {
		m[e.Name] = e.Value
	}
	return m
}

// --- Experimental credential injector path ---

var testEnvoyConfig = func() *config.Config {
	cfg := *testConfig
	cfg.EnvoyImage = "envoyproxy/envoy:distroless-v1.37.2"
	cfg.EnvoyPort = 10000
	return &cfg
}()

func credSecret(name, host string) corev1.Secret {
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Annotations: map[string]string{"humr.ai/host-pattern": host, "humr.ai/injection-header-name": "Authorization"},
			Labels:      map[string]string{"humr.ai/owner": "owner-1", "humr.ai/managed-by": "api-server"},
		},
		Data: map[string][]byte{"value": []byte("Bearer abc")},
	}
}

func TestBuildStatefulSet_FlagOn_AddsEnvoySidecar(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running", ExperimentalCredentialInjector: true}
	// Pass a non-empty credential set so we exercise the real-world rendering
	// (sidecar mounts, leaf-Secret projection into the agent, no fetch-ca-cert)
	// rather than the degenerate empty path.
	secrets := []corev1.Secret{credSecret("humr-cred-aaa", "api.example.com")}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testEnvoyConfig, "my-agent", testOwnerCM, nil, secrets)

	require.Len(t, ss.Spec.Template.Spec.Containers, 2, "agent + envoy sidecar")
	agent := ss.Spec.Template.Spec.Containers[0]
	envoy := ss.Spec.Template.Spec.Containers[1]
	assert.Equal(t, "agent", agent.Name)
	assert.Equal(t, "envoy", envoy.Name)
	assert.Equal(t, "envoyproxy/envoy:distroless-v1.37.2", envoy.Image)

	envMap := envToMap(agent.Env)
	assert.Equal(t, "http://127.0.0.1:10000", envMap["HTTP_PROXY"])
	assert.Equal(t, "http://127.0.0.1:10000", envMap["HTTPS_PROXY"])
	assert.NotContains(t, envMap, "GH_TOKEN", "OneCLI sentinel must be dropped on experimental path")
	// ONECLI_ACCESS_TOKEN is still injected — it's the bearer for
	// api-server → agent-runtime tRPC, independent of the egress path.
	// What must NOT happen is the token leaking into HTTPS_PROXY (Envoy
	// doesn't speak OneCLI auth).
	assert.NotContains(t, envMap["HTTPS_PROXY"], "$(ONECLI_ACCESS_TOKEN)",
		"experimental path must not interpolate the OneCLI token into the proxy URL")
	var tokenEnv *corev1.EnvVar
	for i := range agent.Env {
		if agent.Env[i].Name == "ONECLI_ACCESS_TOKEN" {
			tokenEnv = &agent.Env[i]
			break
		}
	}
	require.NotNil(t, tokenEnv, "agent-runtime needs ONECLI_ACCESS_TOKEN for tRPC bearer auth")
	require.NotNil(t, tokenEnv.ValueFrom)
	require.NotNil(t, tokenEnv.ValueFrom.SecretKeyRef)
	assert.Equal(t, "access-token", tokenEnv.ValueFrom.SecretKeyRef.Key)

	// No fetch-ca-cert init: OneCLI is unreachable on the experimental path
	// (NetworkPolicy drops it) and the agent's CA now comes from the leaf
	// Secret instead.
	for _, ic := range ss.Spec.Template.Spec.InitContainers {
		assert.NotEqual(t, "fetch-ca-cert", ic.Name)
	}

	// Volume/mount names are consistent with what the bootstrap template
	// references — bootstrap renders `cred-<secret>` paths; the sidecar
	// volume must be named identically and mounted at the matching path.
	volNames := map[string]bool{}
	for _, v := range ss.Spec.Template.Spec.Volumes {
		volNames[v.Name] = true
	}
	require.True(t, volNames["cred-humr-cred-aaa"], "credential volume must use cred-<secretName>")
	require.True(t, volNames["envoy-tls"], "leaf-TLS volume must be present")

	envoyMounts := map[string]string{}
	for _, m := range envoy.VolumeMounts {
		envoyMounts[m.Name] = m.MountPath
	}
	assert.Equal(t, "/etc/envoy/credentials/cred-humr-cred-aaa", envoyMounts["cred-humr-cred-aaa"],
		"sidecar mount path must match bootstrap template's $CredentialsRoot/$VolumeName")
	assert.Equal(t, "/etc/envoy/tls", envoyMounts["envoy-tls"],
		"sidecar TLS mount path must match bootstrap template's $LeafTLSDir")
}

func TestBuildStatefulSet_FlagOff_Unchanged(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testEnvoyConfig, "my-agent", testOwnerCM, nil, nil)
	require.Len(t, ss.Spec.Template.Spec.Containers, 1, "no sidecar when flag is off")
	assert.Nil(t, ss.Spec.Template.Spec.AutomountServiceAccountToken, "leave SA-token automount at K8s default when flag is off")
	assert.Nil(t, ss.Spec.Template.Spec.ShareProcessNamespace, "leave share-pid at K8s default when flag is off")
	assert.Empty(t, ss.Spec.Template.Annotations, "no humr-specific pod annotations when flag is off")
	for _, e := range ss.Spec.Template.Spec.Containers[0].Env {
		assert.NotEqual(t, "HUMR_GH_TOKEN_AVAILABLE", e.Name, "GH-token signal env is experimental-path-only")
	}
}

func TestBuildStatefulSet_FlagOn_GHTokenSignal_NoCredential(t *testing.T) {
	// Experimental path with no GitHub credential Secret: signal must say
	// "false" so in-pod tooling can short-circuit instead of failing on a 401.
	instance := &types.InstanceSpec{DesiredState: "running", ExperimentalCredentialInjector: true}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testEnvoyConfig, "my-agent", testOwnerCM, nil, nil)

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "false", envMap["HUMR_GH_TOKEN_AVAILABLE"])
	assert.Equal(t, "false", ss.Spec.Template.Annotations["humr.ai/gh-token-available"])
}

func TestBuildStatefulSet_FlagOn_GHTokenSignal_WithCredential(t *testing.T) {
	// Experimental path with a GitHub credential Secret: signal must say
	// "true" — Envoy will inject Authorization on the wire to api.github.com.
	instance := &types.InstanceSpec{DesiredState: "running", ExperimentalCredentialInjector: true}
	secrets := []corev1.Secret{credSecret("humr-cred-gh", "api.github.com")}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testEnvoyConfig, "my-agent", testOwnerCM, nil, secrets)

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "true", envMap["HUMR_GH_TOKEN_AVAILABLE"])
	assert.Equal(t, "true", ss.Spec.Template.Annotations["humr.ai/gh-token-available"])
}

func TestBuildStatefulSet_FlagOn_SecretMountsSidecarOnly(t *testing.T) {
	secrets := []corev1.Secret{credSecret("humr-cred-aaa", "api.example.com")}
	instance := &types.InstanceSpec{DesiredState: "running", ExperimentalCredentialInjector: true}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testEnvoyConfig, "my-agent", testOwnerCM, nil, secrets)

	volNames := map[string]bool{}
	for _, v := range ss.Spec.Template.Spec.Volumes {
		volNames[v.Name] = true
	}
	assert.True(t, volNames["envoy-bootstrap"], "bootstrap volume must be on the pod")
	assert.True(t, volNames["cred-humr-cred-aaa"], "credential volume must be on the pod")

	agentMounts := ss.Spec.Template.Spec.Containers[0].VolumeMounts
	for _, m := range agentMounts {
		assert.NotEqual(t, "cred-humr-cred-aaa", m.Name, "agent container must not mount credential secrets")
		assert.NotEqual(t, "envoy-bootstrap", m.Name, "agent container must not mount the envoy bootstrap CM")
	}

	envoyMounts := map[string]bool{}
	for _, m := range ss.Spec.Template.Spec.Containers[1].VolumeMounts {
		envoyMounts[m.Name] = true
	}
	assert.True(t, envoyMounts["envoy-bootstrap"])
	assert.True(t, envoyMounts["cred-humr-cred-aaa"])
	assert.True(t, envoyMounts["envoy-tls"], "sidecar must mount the cert-manager-issued leaf for TLS termination")

	// Agent's ca-cert volume is now projected from the leaf Secret, exposing
	// only ca.crt. The leaf private key (tls.key) must NOT be visible to the
	// agent — it's the credential boundary between agent and sidecar.
	var caCertVol *corev1.Volume
	for i, v := range ss.Spec.Template.Spec.Volumes {
		if v.Name == "ca-cert" {
			caCertVol = &ss.Spec.Template.Spec.Volumes[i]
			break
		}
	}
	require.NotNil(t, caCertVol, "ca-cert volume must exist")
	require.NotNil(t, caCertVol.Secret, "ca-cert volume must be sourced from the leaf Secret on the experimental path")
	assert.Equal(t, "my-instance-envoy-tls", caCertVol.Secret.SecretName)
	require.Len(t, caCertVol.Secret.Items, 1)
	assert.Equal(t, "ca.crt", caCertVol.Secret.Items[0].Key, "agent must only see ca.crt — never tls.key")
}

func TestBuildStatefulSet_FlagOn_PodHardening(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running", ExperimentalCredentialInjector: true}
	ss := BuildStatefulSet("my-instance", instance, testAgent, testEnvoyConfig, "my-agent", testOwnerCM, nil, nil)
	require.NotNil(t, ss.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *ss.Spec.Template.Spec.AutomountServiceAccountToken)
	require.NotNil(t, ss.Spec.Template.Spec.ShareProcessNamespace)
	assert.False(t, *ss.Spec.Template.Spec.ShareProcessNamespace)
}

func TestBuildNetworkPolicy_FlagOn_DropsOneCLIPeer(t *testing.T) {
	np := BuildNetworkPolicy("my-instance", testConfig, testOwnerCM, &types.InstanceSpec{DesiredState: "running", ExperimentalCredentialInjector: true})

	for _, rule := range np.Spec.Egress {
		for _, peer := range rule.To {
			if peer.PodSelector != nil {
				assert.NotEqual(t, "onecli", peer.PodSelector.MatchLabels["app.kubernetes.io/component"],
					"OneCLI peer must be dropped when flag is on")
			}
		}
	}

	// Sidecar egress: TCP 443 + 80 with no peer selector.
	var sawHttps bool
	for _, rule := range np.Spec.Egress {
		if len(rule.To) == 0 {
			for _, p := range rule.Ports {
				if p.Port != nil && p.Port.IntVal == 443 {
					sawHttps = true
				}
			}
		}
	}
	assert.True(t, sawHttps, "experimental policy must permit egress on TCP 443")
}

func TestBuildEnvoyBootstrapConfigMap(t *testing.T) {
	secrets := []corev1.Secret{credSecret("humr-cred-aaa", "api.example.com")}
	cm, err := BuildEnvoyBootstrapConfigMap("my-instance", testEnvoyConfig, testOwnerCM, secrets)
	require.NoError(t, err)
	assert.Equal(t, "my-instance-envoy-bootstrap", cm.Name)
	assert.Equal(t, "test-agents", cm.Namespace)
	yaml := cm.Data["envoy.yaml"]
	assert.Contains(t, yaml, "127.0.0.1")
	assert.Contains(t, yaml, "api.example.com", "filter chain must match by SNI on the host")
	assert.Contains(t, yaml, "/etc/envoy/credentials/cred-humr-cred-aaa/sds.yaml")
	// TLS interception: internal listener + leaf cert + upstream forward proxy.
	assert.Contains(t, yaml, "internal_listener", "must declare an internal listener")
	assert.Contains(t, yaml, "envoy.bootstrap.internal_listener", "must enable the internal_listener bootstrap extension")
	assert.Contains(t, yaml, "tls_inspector", "internal listener must inspect SNI")
	assert.Contains(t, yaml, "/etc/envoy/tls/tls.crt", "must reference the cert-manager-issued leaf cert")
	assert.Contains(t, yaml, "/etc/envoy/tls/tls.key", "must reference the leaf private key")
	assert.Contains(t, yaml, "dynamic_forward_proxy_https", "must re-originate upstream TLS")
	assert.Contains(t, yaml, "sni_dynamic_forward_proxy", "must passthrough on SNI miss")
}
