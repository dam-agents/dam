package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

var testConfig = &config.Config{
	Namespace:         "test-agents",
	ReleaseNamespace:  "default",
	ReleaseName:       "platform",
	HarnessServerPort: 4001,
	ExtAuthzPort:      4002,
	EnvoyImage:        "mirror.gcr.io/envoyproxy/envoy:distroless-v1.37.2",
	EnvoyPort:         10000,
	IstioTrustDomain:  "cluster.local",
	IstioWaypointName: "apiserver-waypoint",
	AgentBase: config.AgentBase{
		TerminationGracePeriod: 5,
		ContainerSecurityContext: &corev1.SecurityContext{
			Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
		},
	},
	AgentTemplateDefaults: config.AgentTemplateDefaults{
		ImagePullPolicy: "IfNotPresent",
		StorageSize:     "10Gi",
	},
	AgentProbesEnabled: true,
	RequestsFraction:   0.5,
	RequestsMinCPU:     resource.MustParse("100m"),
	RequestsMinMemory:  resource.MustParse("128Mi"),
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
}

var testOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "my-instance",
		Namespace: "test-agents",
		UID:       "cm-uid-123",
	},
}

func credSecret(name, host string) corev1.Secret {
	ann := map[string]string{
		"agent-platform.ai/injection-hosts": `[{"host":"` + host +
			`","headerName":"Authorization","valueFormat":"Bearer {value}","sdsKey":"` +
			sdsFileKeyForHost(host) + `"}]`,
	}
	if host == "api.github.com" || host == "github.com" || host == "raw.githubusercontent.com" {
		ann["agent-platform.ai/env-mappings"] = `[{"envName":"GH_TOKEN","placeholder":"dummy-placeholder"}]`
	}
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Annotations: ann,
			Labels: map[string]string{
				"agent-platform.ai/owner":       "owner-1",
				"agent-platform.ai/managed-by":  "api-server",
				"agent-platform.ai/secret-type": "connection",
				"agent-platform.ai/connection":  name,
			},
		},
		Data: map[string][]byte{sdsFileKeyForHost(host): []byte("resources: []")},
	}
}

func TestBuildAgentStatefulSet_Running(t *testing.T) {
	agent := *testAgent
	agent.Env = append([]types.EnvVar{}, testAgent.Env...)
	agent.Env = append(agent.Env, types.EnvVar{Name: "GITHUB_ORG", Value: "alpha"})
	agent.SecretRef = "my-secrets"
	ss := BuildAgentStatefulSet("my-instance", &agent, testConfig, configMapOwnerRef(testOwnerCM), "10.96.42.42")

	require.NotNil(t, ss)
	assert.Equal(t, "my-instance", ss.Name)
	assert.Equal(t, "test-agents", ss.Namespace)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	require.Len(t, ss.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(ss.OwnerReferences[0].UID))

	assert.Equal(t, "my-instance", ss.Spec.Template.Labels["agent-platform.ai/agent"])
	assert.Equal(t, "my-instance", ss.Spec.Template.Labels["agent-platform.ai/pair"])
	assert.Equal(t, "agent", ss.Spec.Template.Labels["agent-platform.ai/role"])
	assert.Equal(t, "none", ss.Spec.Template.Labels["istio.io/dataplane-mode"],
		"agent pod must carry istio.io/dataplane-mode=none so NetworkPolicy is the egress boundary")
	assert.NotContains(t, ss.Spec.Selector.MatchLabels, "istio.io/dataplane-mode",
		"selector must remain minimal so ambient enrolment can be flipped without selector churn")

	require.Len(t, ss.Spec.Template.Spec.Containers, 1, "agent only — gateway runs in its own paired pod")
	c := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "agent", c.Name)
	assert.Equal(t, "ghcr.io/myorg/agent:latest", c.Image)
	assert.Equal(t, int32(8080), c.Ports[0].ContainerPort)
	assert.Equal(t, "acp", c.Ports[0].Name)

	assert.Equal(t, "/healthz", c.StartupProbe.HTTPGet.Path)
	assert.Equal(t, int32(1), c.StartupProbe.PeriodSeconds)
	assert.Equal(t, int32(120), c.StartupProbe.FailureThreshold)

	assert.Equal(t, "/healthz", c.LivenessProbe.HTTPGet.Path)
	assert.Equal(t, int32(10), c.LivenessProbe.PeriodSeconds)
	assert.Equal(t, int32(5), c.LivenessProbe.TimeoutSeconds)
	assert.Equal(t, int32(12), c.LivenessProbe.FailureThreshold,
		"liveness must tolerate ~2 min of stall: a 30s kill window destroyed an in-container experiment run when the dev host starved the VM's vCPUs; truly dead agents are still reaped by invocation deadlines and the experiment inactivity sweep")

	envMap := envToMap(c.Env)
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTPS_PROXY"])
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTP_PROXY"])

	for _, e := range c.Env {
		assert.NotEqual(t, "AGENT_RUNTIME_TOKEN", e.Name)
	}
	assert.Equal(t, "/etc/platform/ca/ca.crt", envMap["NODE_EXTRA_CA_CERTS"])
	_, hasSSLCertFile := envMap["SSL_CERT_FILE"]
	assert.False(t, hasSSLCertFile, "SSL_CERT_FILE must be left to the base image")
	_, hasGitCAInfo := envMap["GIT_SSL_CAINFO"]
	assert.False(t, hasGitCAInfo, "GIT_SSL_CAINFO must be left to the system trust store")
	assert.Equal(t, "my-instance", envMap["PLATFORM_AGENT_ID"])
	_, hasACPPort := envMap["ACP_PORT"]
	assert.False(t, hasACPPort, "spec.env must not be projected into the container")
	_, hasGithubOrg := envMap["GITHUB_ORG"]
	assert.False(t, hasGithubOrg, "spec.env must not be projected into the container")

	require.Len(t, c.EnvFrom, 1)
	assert.Equal(t, "my-secrets", c.EnvFrom[0].SecretRef.LocalObjectReference.Name)

	assert.Equal(t, resource.MustParse("250m"), *c.Resources.Requests.Cpu())
	assert.Equal(t, resource.MustParse("2Gi"), *c.Resources.Limits.Memory())

	require.NotNil(t, c.SecurityContext)
	require.NotNil(t, c.SecurityContext.Capabilities)
	assert.Equal(t, []corev1.Capability{"ALL"}, c.SecurityContext.Capabilities.Drop)
}

func TestBuildAgentStatefulSet_DerivesRequestsFromLimits(t *testing.T) {
	cfg := *testConfig
	cfg.AgentTemplateDefaults.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("1"),
			corev1.ResourceMemory: resource.MustParse("1Gi"),
		},
	}
	spec := *testAgent
	spec.Resources = types.ResourceSpec{
		Limits: map[string]string{"cpu": "2", "memory": "2Gi"},
	}
	ss := BuildAgentStatefulSet("my-instance", &spec, &cfg, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	c := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "2", c.Resources.Limits.Cpu().String())
	assert.Equal(t, "2Gi", c.Resources.Limits.Memory().String())
	assert.Equal(t, "1", c.Resources.Requests.Cpu().String())
	assert.Equal(t, "1Gi", c.Resources.Requests.Memory().String())

	spec.Resources = types.ResourceSpec{
		Limits: map[string]string{"cpu": "150m", "memory": "64Mi"},
	}
	ss = BuildAgentStatefulSet("my-instance", &spec, &cfg, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	c = ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "100m", c.Resources.Requests.Cpu().String())
	assert.Equal(t, "64Mi", c.Resources.Requests.Memory().String())

	spec.Resources = types.ResourceSpec{
		Limits:   map[string]string{"cpu": "500m"},
		Requests: map[string]string{"cpu": "250m"},
	}
	ss = BuildAgentStatefulSet("my-instance", &spec, &cfg, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	c = ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "500m", c.Resources.Limits.Cpu().String())
	assert.Equal(t, "1Gi", c.Resources.Limits.Memory().String())
	assert.Equal(t, "250m", c.Resources.Requests.Cpu().String())
	assert.Equal(t, "512Mi", c.Resources.Requests.Memory().String())
}

func TestBuildAgentStatefulSet_ProbesDisabled(t *testing.T) {
	cfg := *testConfig
	cfg.AgentProbesEnabled = false
	ss := BuildAgentStatefulSet("my-instance", testAgent, &cfg, configMapOwnerRef(testOwnerCM), "")

	c := ss.Spec.Template.Spec.Containers[0]
	assert.Nil(t, c.StartupProbe)
	assert.Nil(t, c.ReadinessProbe)
	assert.Nil(t, c.LivenessProbe)
}

func TestBuildAgentStatefulSet_DefaultsToRunningReplicas(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "")
	assert.Equal(t, int32(1), *ss.Spec.Replicas)
}

func TestBuildAgentStatefulSet_IgnoresSpecInit(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "")
	assert.Empty(t, ss.Spec.Template.Spec.InitContainers)
}

func TestBuildAgentStatefulSet_Volumes(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "")

	require.Len(t, ss.Spec.VolumeClaimTemplates, 1)
	pvc := ss.Spec.VolumeClaimTemplates[0]
	assert.Equal(t, "home-agent", pvc.Name)
	assert.Equal(t, []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, pvc.Spec.AccessModes)
	assert.Nil(t, pvc.Spec.StorageClassName, "unset StorageClass → PVC gets cluster-default class")

	volMap := make(map[string]corev1.Volume)
	for _, v := range ss.Spec.Template.Spec.Volumes {
		volMap[v.Name] = v
	}
	assert.NotNil(t, volMap["tmp"].EmptyDir)
	require.NotNil(t, volMap["ca-cert"].Secret)
	assert.Equal(t, "my-instance-envoy-tls", volMap["ca-cert"].Secret.SecretName)
	require.Len(t, volMap["ca-cert"].Secret.Items, 1)
	assert.Equal(t, "ca.crt", volMap["ca-cert"].Secret.Items[0].Key)

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
	ss := BuildAgentStatefulSet("my-instance", &agent, testConfig, configMapOwnerRef(testOwnerCM), "")

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
	ss := BuildAgentStatefulSet("my-instance", testAgent, &cfg, configMapOwnerRef(testOwnerCM), "")

	require.Len(t, ss.Spec.VolumeClaimTemplates, 1)
	pvc := ss.Spec.VolumeClaimTemplates[0]
	require.NotNil(t, pvc.Spec.StorageClassName)
	assert.Equal(t, "platform-rwx", *pvc.Spec.StorageClassName)
}

func TestBuildAgentStatefulSet_SpecStorageClassOverridesBase(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.StorageClass = "platform-rwx"
	spec := *testAgent
	spec.StorageClass = "fast-block"
	ss := BuildAgentStatefulSet("my-instance", &spec, &cfg, configMapOwnerRef(testOwnerCM), "")

	require.Len(t, ss.Spec.VolumeClaimTemplates, 1)
	pvc := ss.Spec.VolumeClaimTemplates[0]
	require.NotNil(t, pvc.Spec.StorageClassName)
	assert.Equal(t, "fast-block", *pvc.Spec.StorageClassName)
}

func TestBuildAgentStatefulSet_PodFilesEventsURL(t *testing.T) {
	cfg := *testConfig
	cfg.HarnessServerURL = "http://platform-apiserver.default.svc:4001"
	ss := BuildAgentStatefulSet("my-instance", testAgent, &cfg, configMapOwnerRef(testOwnerCM), "")

	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t,
		"http://platform-apiserver.default.svc:4001/api/agents/my-instance/pod-files/events",
		envMap["PLATFORM_POD_FILES_EVENTS_URL"])
}

func TestBuildAgentStatefulSet_NoSecretRef(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "")
	assert.Empty(t, ss.Spec.Template.Spec.Containers[0].EnvFrom)
}

func TestBuildAgentStatefulSet_NoCredentialMountsOnAgent(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "")

	require.Len(t, ss.Spec.Template.Spec.Containers, 1, "no sidecar — gateway is its own pod")

	for _, v := range ss.Spec.Template.Spec.Volumes {
		assert.NotEqual(t, "envoy-bootstrap", v.Name, "agent pod must not mount the Envoy bootstrap CM")
		assert.NotEqual(t, "envoy-tls", v.Name, "agent pod must not mount the leaf TLS Secret with the private key")
		assert.NotContains(t, v.Name, "cred-platform-cred-", "agent pod must not mount any credential Secret")
	}

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

func TestBuildAgentService(t *testing.T) {
	svc := BuildAgentService("my-instance", testConfig, configMapOwnerRef(testOwnerCM))
	assert.Equal(t, "my-instance", svc.Name)
	assert.Equal(t, "test-agents", svc.Namespace)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)
	assert.Equal(t, int32(8080), svc.Spec.Ports[0].Port)
	assert.Equal(t, "acp", svc.Spec.Ports[0].Name)
	assert.Equal(t, "my-instance", svc.Spec.Selector["agent-platform.ai/pair"])
	assert.Equal(t, "agent", svc.Spec.Selector["agent-platform.ai/role"])
	require.Len(t, svc.OwnerReferences, 1)
}

func envToMap(envs []corev1.EnvVar) map[string]string {
	m := make(map[string]string)
	for _, e := range envs {
		m[e.Name] = e.Value
	}
	return m
}

func TestBuildAgentStatefulSet_PodHardening(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "")
	require.NotNil(t, ss.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *ss.Spec.Template.Spec.AutomountServiceAccountToken)
	require.NotNil(t, ss.Spec.Template.Spec.ShareProcessNamespace)
	assert.False(t, *ss.Spec.Template.Spec.ShareProcessNamespace)
}

func TestBuildAgentStatefulSet_ProxyURLUsesIPDirectly(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTPS_PROXY"], "must be IP-direct when gateway IP is known")
	assert.Equal(t, "http://10.96.42.42:10000", envMap["HTTP_PROXY"])
	assert.Equal(t, "http://10.96.42.42:10000", envMap["https_proxy"])
	assert.Equal(t, "http://10.96.42.42:10000", envMap["http_proxy"])
}

func TestBuildEnvoyBootstrapConfigMap(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	cm, err := BuildEnvoyBootstrapConfigMap("my-instance", "", testConfig, configMapOwnerRef(testOwnerCM), secrets, nil)
	require.NoError(t, err)
	assert.Equal(t, "my-instance-envoy-bootstrap", cm.Name)
	assert.Equal(t, "test-agents", cm.Namespace)
	yaml := cm.Data["envoy.yaml"]
	assert.Contains(t, yaml, "0.0.0.0")
	assert.NotContains(t, yaml, "127.0.0.1", "gateway listener must not bind loopback under the paired-pod model")
	assert.Contains(t, yaml, "api.example.com", "filter chain must match by SNI on the host")
	assert.Contains(t, yaml, "/etc/envoy/credentials/cred-platform-cred-aaa/"+sdsFileKeyForHost("api.example.com"))
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

func hasVCT(ss *appsv1.StatefulSet, name string) bool {
	for _, v := range ss.Spec.VolumeClaimTemplates {
		if v.Name == name {
			return true
		}
	}
	return false
}

func podClaimName(ss *appsv1.StatefulSet, volName string) (string, bool) {
	for _, v := range ss.Spec.Template.Spec.Volumes {
		if v.Name == volName && v.PersistentVolumeClaim != nil {
			return v.PersistentVolumeClaim.ClaimName, true
		}
	}
	return "", false
}

func TestBuildAgentStatefulSet_PersistedVCTCarriesMountLabel(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	var vct *corev1.PersistentVolumeClaim
	for i := range ss.Spec.VolumeClaimTemplates {
		if ss.Spec.VolumeClaimTemplates[i].Name == "home-agent" {
			vct = &ss.Spec.VolumeClaimTemplates[i]
		}
	}
	require.NotNil(t, vct, "/home/agent persists → a volumeClaimTemplate")
	assert.Equal(t, "my-instance", vct.Labels[LabelAgent])
	assert.Equal(t, "home-agent", vct.Labels[LabelMount])
}

func TestApplyPoolClaims_SwapsVCTForClaimName(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	require.True(t, hasVCT(ss, "home-agent"), "testAgent persists /home/agent → a volumeClaimTemplate")

	applyPoolClaims(ss, map[string]string{"home-agent": "platform-pool-abc123"})

	assert.False(t, hasVCT(ss, "home-agent"), "claimed mount dropped from volumeClaimTemplates")
	claim, ok := podClaimName(ss, "home-agent")
	require.True(t, ok, "claimed mount becomes an explicit pod volume")
	assert.Equal(t, "platform-pool-abc123", claim)
}

func TestApplyPoolClaims_NilIsNoop(t *testing.T) {
	ss := BuildAgentStatefulSet("my-instance", testAgent, testConfig, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	before := len(ss.Spec.VolumeClaimTemplates)

	applyPoolClaims(ss, nil)

	assert.Len(t, ss.Spec.VolumeClaimTemplates, before)
	assert.True(t, hasVCT(ss, "home-agent"))
	_, ok := podClaimName(ss, "home-agent")
	assert.False(t, ok, "no pool claim → no explicit claimName volume")
}

func TestApplyPoolClaims_PartialMultiMount(t *testing.T) {
	agent := *testAgent
	agent.Mounts = []types.Mount{
		{Path: "/home/agent", Persist: true, Size: "2Gi"},
		{Path: "/cache", Persist: true},
	}
	ss := BuildAgentStatefulSet("my-instance", &agent, testConfig, configMapOwnerRef(testOwnerCM), "10.96.42.42")
	require.True(t, hasVCT(ss, "home-agent"))
	require.True(t, hasVCT(ss, "cache"))

	applyPoolClaims(ss, map[string]string{"home-agent": "platform-pool-xyz"})

	assert.False(t, hasVCT(ss, "home-agent"), "claimed mount swapped")
	assert.True(t, hasVCT(ss, "cache"), "unclaimed mount keeps its volumeClaimTemplate")
	claim, ok := podClaimName(ss, "home-agent")
	require.True(t, ok)
	assert.Equal(t, "platform-pool-xyz", claim)
}
