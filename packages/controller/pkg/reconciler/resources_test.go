package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// testConfig mirrors what the Helm chart writes into AGENT_BASE and
// AGENT_TEMPLATE_DEFAULTS (see values.yaml `controller.agent`). The
// controller has no Go-side defaults for these — the chart is the sole
// source of truth — so tests must set them explicitly to match production.
var testConfig = &config.Config{
	Namespace:         "test-agents",
	ReleaseNamespace:  "default",
	ReleaseName:       "platform",
	HarnessServerPort: 4001,
	ExtAuthzPort:      4002,
	EnvoyImage:        "envoyproxy/envoy:distroless-v1.37.2",
	EnvoyPort:         10000,
	IstioTrustDomain:  "cluster.local",
	IstioWaypointName: "apiserver-waypoint",
	AgentBase: config.AgentBase{
		AccessMode:             "ReadWriteMany",
		TerminationGracePeriod: 5,
		ContainerSecurityContext: &corev1.SecurityContext{
			Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
		},
	},
	AgentTemplateDefaults: config.AgentTemplateDefaults{
		AgentHome:       "/home/agent",
		ImagePullPolicy: "IfNotPresent",
		StorageSize:     "10Gi",
	},
	AgentProbesEnabled: true,
}

// testAgent carries the merged Agent fields (ADR-046): image/mounts/env
// from the former AgentSpec PLUS the runtime fields (DesiredState,
// SecretRef) that used to live on the retired InstanceSpec. Most tests
// inherit "running" — hibernation-specific tests override with a local
// copy.
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
	DesiredState: "running",
}

var testOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "my-instance",
		Namespace: "test-agents",
		UID:       "cm-uid-123",
	},
}

func boolPtr(b bool) *bool { return &b }

func credSecret(name, host string) corev1.Secret {
	ann := map[string]string{
		"agent-platform.ai/host-pattern":          host,
		"agent-platform.ai/injection-header-name": "Authorization",
	}
	// Fixtures targeting github hosts also declare GH_TOKEN in their
	// env-mappings — mirrors what the api-server's github descriptor
	// stamps, so `hasGHTokenEnv` returns true for these Secrets.
	if host == "api.github.com" || host == "github.com" || host == "raw.githubusercontent.com" {
		ann["agent-platform.ai/env-mappings"] = `[{"envName":"GH_TOKEN","placeholder":"dummy-placeholder"}]`
	}
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Annotations: ann,
			Labels:      map[string]string{"agent-platform.ai/owner": "owner-1", "agent-platform.ai/managed-by": "api-server"},
		},
		Data: map[string][]byte{"value": []byte("Bearer abc")},
	}
}

// --- Agent StatefulSet tests ---

func TestBuildAgentStatefulSet_Running(t *testing.T) {
	// ADR-046: env + secretRef live on the merged AgentSpec — extend a
	// copy of testAgent rather than carrying a separate InstanceSpec.
	agent := *testAgent
	agent.Env = append([]types.EnvVar{}, testAgent.Env...)
	agent.Env = append(agent.Env, types.EnvVar{Name: "GITHUB_ORG", Value: "alpha"})
	agent.SecretRef = "my-secrets"
	ss := BuildAgentStatefulSet("my-instance", &agent, testConfig, testOwnerCM, nil, "10.96.42.42")

	require.NotNil(t, ss)
	assert.Equal(t, "my-instance", ss.Name)
	assert.Equal(t, "test-agents", ss.Namespace)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	require.Len(t, ss.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(ss.OwnerReferences[0].UID))

	assert.Equal(t, "my-instance", ss.Spec.Template.Labels["agent-platform.ai/agent"])
	assert.Equal(t, "my-instance", ss.Spec.Template.Labels["agent-platform.ai/pair"])
	assert.Equal(t, "agent", ss.Spec.Template.Labels["agent-platform.ai/role"])
	// Agent pod opts out of ambient mesh — load-bearing for the per-pair
	// agent-egress NetworkPolicy: with ambient, istio-cni rewrites every
	// outbound to ztunnel:15008 before the NP filter sees the destination,
	// so per-destination rules can't gate effectively.
	assert.Equal(t, "none", ss.Spec.Template.Labels["istio.io/dataplane-mode"],
		"agent pod must carry istio.io/dataplane-mode=none so NetworkPolicy is the egress boundary")
	// The StatefulSet's own selector must NOT include the dataplane-mode
	// label — otherwise removing it later would orphan existing pods.
	assert.NotContains(t, ss.Spec.Selector.MatchLabels, "istio.io/dataplane-mode",
		"selector must remain minimal so ambient enrolment can be flipped without selector churn")

	require.Len(t, ss.Spec.Template.Spec.Containers, 1, "agent only — gateway runs in its own paired pod (ADR-038)")
	c := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "agent", c.Name)
	assert.Equal(t, "ghcr.io/myorg/agent:latest", c.Image)
	assert.Equal(t, int32(8080), c.Ports[0].ContainerPort)
	assert.Equal(t, "acp", c.Ports[0].Name)

	assert.Equal(t, "/healthz", c.StartupProbe.HTTPGet.Path)
	assert.Equal(t, int32(1), c.StartupProbe.PeriodSeconds)
	assert.Equal(t, int32(120), c.StartupProbe.FailureThreshold)

	envMap := envToMap(c.Env)
	// HTTPS_PROXY is IP-direct — the gateway's ClusterIP literal so
	// there's no DNS dependency (egress NP denies port 53).
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTPS_PROXY"])
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTP_PROXY"])

	for _, e := range c.Env {
		assert.NotEqual(t, "AGENT_RUNTIME_TOKEN", e.Name)
	}
	assert.Equal(t, "/etc/platform/ca/ca.crt", envMap["SSL_CERT_FILE"])
	assert.Equal(t, "/etc/platform/ca/ca.crt", envMap["NODE_EXTRA_CA_CERTS"])
	assert.Equal(t, "my-instance", envMap["PLATFORM_AGENT_ID"])
	assert.Equal(t, "8080", envMap["ACP_PORT"])
	assert.Equal(t, "alpha", envMap["GITHUB_ORG"])

	require.Len(t, c.EnvFrom, 1)
	assert.Equal(t, "my-secrets", c.EnvFrom[0].SecretRef.LocalObjectReference.Name)

	assert.Equal(t, resource.MustParse("250m"), *c.Resources.Requests.Cpu())
	assert.Equal(t, resource.MustParse("2Gi"), *c.Resources.Limits.Memory())

	// Security context is chart-only — applied from AgentBase.ContainerSecurityContext.
	require.NotNil(t, c.SecurityContext)
	require.NotNil(t, c.SecurityContext.Capabilities)
	assert.Equal(t, []corev1.Capability{"ALL"}, c.SecurityContext.Capabilities.Drop)
}

func TestBuildAgentStatefulSet_ProbesDisabled(t *testing.T) {
	cfg := *testConfig
	cfg.AgentProbesEnabled = false
	ss := BuildAgentStatefulSet("my-instance", testAgent, &cfg, testOwnerCM, nil, "")

	c := ss.Spec.Template.Spec.Containers[0]
	assert.Nil(t, c.StartupProbe)
	assert.Nil(t, c.ReadinessProbe)
	assert.Nil(t, c.LivenessProbe)
}

func TestBuildAgentStatefulSet_Hibernated(t *testing.T) {
	hibernated := *testAgent
	hibernated.DesiredState = "hibernated"
	ss := BuildAgentStatefulSet("my-instance", &hibernated, testConfig, testOwnerCM, nil, "")
	assert.Equal(t, int32(0), *ss.Spec.Replicas)
}

func TestBuildAgentStatefulSet_InitContainer(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, nil, "")
	require.Len(t, ss.Spec.Template.Spec.InitContainers, 1, "only the user-defined init runs")
	ic := ss.Spec.Template.Spec.InitContainers[0]
	assert.Equal(t, "init", ic.Name)
	assert.Equal(t, "ghcr.io/myorg/agent:latest", ic.Image)
	assert.Equal(t, []string{"sh", "-c", testAgent.Init}, ic.Command)
}

func TestBuildAgentStatefulSet_NoUserInitWhenEmpty(t *testing.T) {
	agent := *testAgent
	agent.Init = ""
	ss := BuildAgentStatefulSet("my-instance", &agent, testConfig, testOwnerCM, nil, "")
	assert.Empty(t, ss.Spec.Template.Spec.InitContainers)
}

func TestBuildAgentStatefulSet_Volumes(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, nil, "")

	require.Len(t, ss.Spec.VolumeClaimTemplates, 1)
	pvc := ss.Spec.VolumeClaimTemplates[0]
	assert.Equal(t, "home-agent", pvc.Name)
	assert.Equal(t, []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany}, pvc.Spec.AccessModes)
	assert.Nil(t, pvc.Spec.StorageClassName, "unset StorageClass → PVC gets cluster-default class")

	volMap := make(map[string]corev1.Volume)
	for _, v := range ss.Spec.Template.Spec.Volumes {
		volMap[v.Name] = v
	}
	assert.NotNil(t, volMap["tmp"].EmptyDir)
	// Without credential secrets, the ca-cert volume is an emptyDir fallback.
	assert.NotNil(t, volMap["ca-cert"].EmptyDir)

	c := ss.Spec.Template.Spec.Containers[0]
	mountPaths := make(map[string]string)
	for _, m := range c.VolumeMounts {
		mountPaths[m.MountPath] = m.Name
	}
	assert.Equal(t, "home-agent", mountPaths["/home/agent"])
	assert.Equal(t, "tmp", mountPaths["/tmp"])
	assert.Equal(t, "ca-cert", mountPaths["/etc/platform/ca"])
}

func TestBuildAgentStatefulSet_PVCSize(t *testing.T) {
	agent := types.AgentSpec{
		Image: "platform-test:latest",
		Mounts: []types.Mount{
			{Path: "/home/agent", Persist: true, Size: "2Gi"},
			{Path: "/cache", Persist: true},
		},
	}
	ss := BuildAgentStatefulSet("my-instance", &agent, testConfig, testOwnerCM, nil, "")

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

func TestBuildAgentStatefulSet_AgentStorageClass(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.StorageClass = "platform-rwx"
	ss := BuildAgentStatefulSet("my-instance", testAgent, &cfg, testOwnerCM, nil, "")

	require.Len(t, ss.Spec.VolumeClaimTemplates, 1)
	pvc := ss.Spec.VolumeClaimTemplates[0]
	require.NotNil(t, pvc.Spec.StorageClassName)
	assert.Equal(t, "platform-rwx", *pvc.Spec.StorageClassName)
}

func TestBuildAgentStatefulSet_PodFilesEventsURL(t *testing.T) {
	cfg := *testConfig
	cfg.HarnessServerURL = "http://platform-apiserver.default.svc:4001"
	ss := BuildAgentStatefulSet("my-instance", testAgent, &cfg, testOwnerCM, nil, "")

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t,
		"http://platform-apiserver.default.svc:4001/api/agents/my-instance/pod-files/events",
		envMap["PLATFORM_POD_FILES_EVENTS_URL"])
}

func TestBuildAgentStatefulSet_NoSecretRef(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, nil, "")
	assert.Empty(t, ss.Spec.Template.Spec.Containers[0].EnvFrom)
}

func TestBuildAgentStatefulSet_NoCredentialMountsOnAgent(t *testing.T) {
	// ADR-038: the agent pod's only platform-issued data is the CA cert
	// (single-key projection of the leaf Secret). No credential Secrets,
	// no Envoy bootstrap CM, no leaf private key.
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, secrets, "")

	require.Len(t, ss.Spec.Template.Spec.Containers, 1, "no sidecar — gateway is its own pod")

	for _, v := range ss.Spec.Template.Spec.Volumes {
		assert.NotEqual(t, "envoy-bootstrap", v.Name, "agent pod must not mount the Envoy bootstrap CM")
		assert.NotEqual(t, "envoy-tls", v.Name, "agent pod must not mount the leaf TLS Secret with the private key")
		assert.NotContains(t, v.Name, "cred-platform-cred-", "agent pod must not mount any credential Secret")
	}

	// CA cert volume IS still on the agent — projected from the leaf Secret
	// with single-key projection (ca.crt only).
	var caCertVol *corev1.Volume
	for i, v := range ss.Spec.Template.Spec.Volumes {
		if v.Name == "ca-cert" {
			caCertVol = &ss.Spec.Template.Spec.Volumes[i]
			break
		}
	}
	require.NotNil(t, caCertVol, "ca-cert volume must exist on the agent pod")
	require.NotNil(t, caCertVol.Secret, "ca-cert volume must be sourced from the leaf Secret")
	assert.Equal(t, "my-instance-envoy-tls", caCertVol.Secret.SecretName)
	require.Len(t, caCertVol.Secret.Items, 1)
	assert.Equal(t, "ca.crt", caCertVol.Secret.Items[0].Key, "agent must only see ca.crt — never tls.key")
}

// --- Agent Service tests ---

func TestBuildAgentService(t *testing.T) {
	svc := BuildAgentService("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "my-instance", svc.Name)
	assert.Equal(t, "test-agents", svc.Namespace)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)
	assert.Equal(t, int32(8080), svc.Spec.Ports[0].Port)
	assert.Equal(t, "acp", svc.Spec.Ports[0].Name)
	// Selector pins to pair + role=agent so the gateway pod (same instance
	// label) is excluded.
	assert.Equal(t, "my-instance", svc.Spec.Selector["agent-platform.ai/pair"])
	assert.Equal(t, "agent", svc.Spec.Selector["agent-platform.ai/role"])
	require.Len(t, svc.OwnerReferences, 1)
}

// ADR-041: per-instance pair-key NetworkPolicy is gone (mesh
// AuthorizationPolicy handles pair isolation cryptographically). The
// previous TestBuildAgentNetworkPolicy is no longer applicable.

func envToMap(envs []corev1.EnvVar) map[string]string {
	m := make(map[string]string)
	for _, e := range envs {
		m[e.Name] = e.Value
	}
	return m
}

// --- GH_TOKEN signal ---

func TestBuildAgentStatefulSet_GHTokenSignal_NoCredential(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, nil, "")

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "false", envMap["PLATFORM_GH_TOKEN_AVAILABLE"])
	assert.Equal(t, "false", ss.Spec.Template.Annotations["agent-platform.ai/gh-token-available"])
}

func TestBuildAgentStatefulSet_GHTokenSignal_WithCredential(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-gh", "api.github.com")}
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, secrets, "")

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "true", envMap["PLATFORM_GH_TOKEN_AVAILABLE"])
	assert.Equal(t, "true", ss.Spec.Template.Annotations["agent-platform.ai/gh-token-available"])
	// Declarative env-mappings on the Secret land as actual container env
	// — the agent SDK reads GH_TOKEN, sends Bearer, Envoy overwrites on
	// the wire. Without this on the StatefulSet, the SDK never dispatches.
	assert.Equal(t, "dummy-placeholder", envMap["GH_TOKEN"])
}

func TestBuildAgentStatefulSet_PodHardening(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, nil, "")
	require.NotNil(t, ss.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *ss.Spec.Template.Spec.AutomountServiceAccountToken)
	require.NotNil(t, ss.Spec.Template.Spec.ShareProcessNamespace)
	assert.False(t, *ss.Spec.Template.Spec.ShareProcessNamespace)
}

// When the controller knows the gateway ClusterIP, HTTPS_PROXY must use
// the IP literal — no DNS dependency, so the egress NetworkPolicy can
// deny port 53 entirely. Falls back to the Service DNS name only when
// the IP isn't known yet (first reconcile race).
func TestBuildAgentStatefulSet_ProxyURLUsesIPDirectly(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, testOwnerCM, nil, "10.96.42.42")
	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTPS_PROXY"], "must be IP-direct when gateway IP is known")
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTP_PROXY"])
	assert.Equal(t, "http://10.96.42.42:10000", envMap["https_proxy"])
	assert.Equal(t, "http://10.96.42.42:10000", envMap["http_proxy"])
}

// --- Envoy bootstrap rendering (still produces the same YAML, just bound on 0.0.0.0 now) ---

func TestBuildEnvoyBootstrapConfigMap(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	cm, err := BuildEnvoyBootstrapConfigMap("my-instance", "my-instance", testConfig, testOwnerCM, secrets)
	require.NoError(t, err)
	assert.Equal(t, "my-instance-envoy-bootstrap", cm.Name)
	assert.Equal(t, "test-agents", cm.Namespace)
	yaml := cm.Data["envoy.yaml"]
	// ADR-038: gateway listener binds 0.0.0.0; reach is gated by NetworkPolicy.
	assert.Contains(t, yaml, "0.0.0.0")
	assert.NotContains(t, yaml, "127.0.0.1", "gateway listener must not bind loopback under the paired-pod model")
	assert.Contains(t, yaml, "api.example.com", "filter chain must match by SNI on the host")
	assert.Contains(t, yaml, "/etc/envoy/credentials/cred-platform-cred-aaa/sds.yaml")
	// path_config_source must declare `watched_directory` pointing at the
	// Secret-volume mount root — otherwise Envoy never observes the kubelet
	// symlink swap that delivers a rotated token. Regression for the
	// refresh-but-stale-injection bug (gateways kept serving the pre-refresh
	// access token).
	assert.Contains(t, yaml, "watched_directory:")
	assert.Contains(t, yaml, "path: /etc/envoy/credentials/cred-platform-cred-aaa",
		"watched_directory must point at the Secret-volume mount root for kubelet's symlink swap to be detected")
	assert.Contains(t, yaml, "internal_listener", "must declare an internal listener")
	assert.Contains(t, yaml, "envoy.bootstrap.internal_listener", "must enable the internal_listener bootstrap extension")
	assert.Contains(t, yaml, "tls_inspector", "internal listener must inspect SNI")
	assert.Contains(t, yaml, "/etc/envoy/tls/tls.crt", "must reference the cert-manager-issued leaf cert")
	assert.Contains(t, yaml, "/etc/envoy/tls/tls.key", "must reference the leaf private key")
	assert.Contains(t, yaml, "dynamic_forward_proxy_https", "must re-originate upstream TLS")
	assert.Contains(t, yaml, "sni_dynamic_forward_proxy", "must passthrough on SNI miss")
}
