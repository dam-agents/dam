package config

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromEnv_AllSet(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_AGENT_NAMESPACE":   "test-agents",
		"PLATFORM_RELEASE_NAMESPACE": "custom-ns",
		"PLATFORM_RELEASE_NAME":      "my-release",
		"PLATFORM_LEASE_NAME":        "custom-lease",
		"POD_NAME":                   "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "test-agents", cfg.Namespace)
	assert.Equal(t, "custom-ns", cfg.ReleaseNamespace)
	assert.Equal(t, "my-release", cfg.ReleaseName)
	assert.Equal(t, "custom-lease", cfg.LeaseName)
	assert.Equal(t, "controller-0", cfg.PodName)
}

func TestLoadFromEnv_Defaults(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "platform-agents", cfg.Namespace)
	assert.Equal(t, "default", cfg.ReleaseNamespace)
	assert.Equal(t, "platform-controller", cfg.LeaseName)
	assert.Equal(t, "/home/agent", cfg.AgentTemplateDefaults.AgentHome)
	assert.Equal(t, "platform-extauthz-inst-1.default.svc.cluster.local", cfg.ExtAuthzHostFor("inst-1"))
}

func TestLoadFromEnv_Telemetry(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Empty(t, cfg.TelemetryCollectorHost)
	assert.False(t, cfg.TelemetryEnabled())
	assert.Equal(t, 4318, cfg.TelemetryCollectorPort)

	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":             "platform",
		"POD_NAME":                          "controller-0",
		"PLATFORM_TELEMETRY_COLLECTOR_HOST": "platform-clickstack-collector.platform.svc.cluster.local",
		"PLATFORM_TELEMETRY_COLLECTOR_PORT": "4318",
	})
	cfg, err = LoadFromEnv()
	require.NoError(t, err)
	assert.True(t, cfg.TelemetryEnabled())
	assert.Equal(t, "platform-clickstack-collector.platform.svc.cluster.local", cfg.TelemetryCollectorHost)
	assert.Equal(t, 4318, cfg.TelemetryCollectorPort)
}

func TestLoadFromEnv_RejectsMissingRequiredAgentBase(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE":            `{}`,
	})
	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "terminationGracePeriod")
}

func TestLoadFromEnv_RejectsMissingStorageSize(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":   "platform",
		"POD_NAME":                "controller-0",
		"AGENT_TEMPLATE_DEFAULTS": `{}`,
	})
	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "storageSize")
}

func TestLoadFromEnv_RejectsMissingContainerSecurityContext(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE":            `{"terminationGracePeriod": 5}`,
	})
	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "containerSecurityContext")
}

func TestExtAuthzHostFor_ComposesFQDN(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":      "my-release",
		"PLATFORM_RELEASE_NAMESPACE": "custom-ns",
		"POD_NAME":                   "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "my-release-extauthz-abc.custom-ns.svc.cluster.local", cfg.ExtAuthzHostFor("abc"))
}

func TestPrincipalFor_SPIFFEShape(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":       "platform",
		"POD_NAME":                    "controller-0",
		"PLATFORM_AGENT_NAMESPACE":    "agents",
		"PLATFORM_ISTIO_TRUST_DOMAIN": "td.local",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "td.local/ns/agents/sa/inst-x", cfg.PrincipalFor("inst-x"))
}

func TestLoadFromEnv_MissingRequired(t *testing.T) {
	setEnv(t, map[string]string{})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "PLATFORM_RELEASE_NAME")
}

func TestLoadFromEnv_MissingPodName(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
	})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "POD_NAME")
}

func TestLoadFromEnv_AgentBase_Parsed(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE": `{
			"imagePullSecrets": ["regcred"],
			"storageClass": "platform-rwx",
			"idleTimeout": "30m",
			"terminationGracePeriod": 10,
			"runtimeClassName": "kata",
			"nodeSelector": {"workload": "agents"},
			"tolerations": [{"key": "dedicated", "operator": "Equal", "value": "agents", "effect": "NoSchedule"}],
			"probes": {"startup": {"httpGet": {"path": "/h", "port": "acp"}, "periodSeconds": 5}},
			"containerSecurityContext": {"capabilities": {"drop": ["ALL"]}}
		}`,
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	b := cfg.AgentBase
	assert.Equal(t, []string{"regcred"}, b.ImagePullSecrets)
	assert.Equal(t, "platform-rwx", b.StorageClass)
	assert.Equal(t, 30*time.Minute, b.IdleTimeout.AsDuration())
	assert.Equal(t, int64(10), b.TerminationGracePeriod)
	assert.Equal(t, "kata", b.RuntimeClassName)
	assert.Equal(t, "agents", b.NodeSelector["workload"])
	require.Len(t, b.Tolerations, 1)
	assert.Equal(t, "dedicated", b.Tolerations[0].Key)
	require.NotNil(t, b.Probes)
	require.NotNil(t, b.Probes.Startup)
	require.NotNil(t, b.ContainerSecurityContext)
}

func TestLoadFromEnv_AgentTemplateDefaults_Parsed(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_TEMPLATE_DEFAULTS": `{
			"agentHome": "/home/agent",
			"imagePullPolicy": "IfNotPresent",
			"storageSize": "10Gi",
			"resources": {"limits": {"cpu": "1", "memory": "1Gi"}},
			"mounts": [{"path": "$HOME", "persist": true}, {"path": "/tmp"}],
			"env": [{"name": "PORT", "value": "8080"}]
		}`,
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	d := cfg.AgentTemplateDefaults
	assert.Equal(t, "/home/agent", d.AgentHome)
	assert.Equal(t, "IfNotPresent", d.ImagePullPolicy)
	assert.Equal(t, "10Gi", d.StorageSize)
	require.Len(t, d.Mounts, 2)
	assert.Equal(t, "$HOME", d.Mounts[0].Path)
	assert.True(t, d.Mounts[0].Persist)
	require.Len(t, d.Env, 1)
	assert.Equal(t, "PORT", d.Env[0].Name)
}

func TestLoadFromEnv_AgentBase_IdleTimeoutZero(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE":            `{"terminationGracePeriod": 5, "idleTimeout": "0s", "containerSecurityContext": {"capabilities": {"drop": ["ALL"]}}}`,
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, time.Duration(0), cfg.AgentBase.IdleTimeout.AsDuration())
}

func TestLoadFromEnv_UnknownFieldRejected(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
		"AGENT_BASE":            `{"runtimeClasName": "kata"}`,
	})
	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AGENT_BASE")
}

const (
	minAgentBaseJSON             = `{"terminationGracePeriod": 5, "containerSecurityContext": {"capabilities": {"drop": ["ALL"]}}}`
	minAgentTemplateDefaultsJSON = `{"storageSize": "10Gi", "resources": {"limits": {"cpu": "1", "memory": "1Gi"}}}`
)

func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, key := range []string{
		"PLATFORM_AGENT_NAMESPACE", "PLATFORM_RELEASE_NAMESPACE", "PLATFORM_RELEASE_NAME",
		"PLATFORM_LEASE_NAME", "POD_NAME",
		"AGENT_BASE", "AGENT_TEMPLATE_DEFAULTS",
		"OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_PROTOCOL",
		"OTEL_TRACES_SAMPLER", "OTEL_TRACES_SAMPLER_ARG",
		"OTEL_RESOURCE_ATTRIBUTES", "OTEL_SERVICE_NAME",
		"EXT_AUTHZ_PORT", "EXT_AUTHZ_HOLD_SECONDS",
		"PLATFORM_ISTIO_TRUST_DOMAIN", "PLATFORM_ISTIO_WAYPOINT_NAME",
		"PLATFORM_TELEMETRY_COLLECTOR_HOST", "PLATFORM_TELEMETRY_COLLECTOR_PORT",
	} {
		os.Unsetenv(key)
		t.Cleanup(func() { os.Unsetenv(key) })
	}
	if _, ok := vars["AGENT_BASE"]; !ok {
		t.Setenv("AGENT_BASE", minAgentBaseJSON)
	}
	if _, ok := vars["AGENT_TEMPLATE_DEFAULTS"]; !ok {
		t.Setenv("AGENT_TEMPLATE_DEFAULTS", minAgentTemplateDefaultsJSON)
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}

func TestLoadFromEnv_OTelEnv_Relayed(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":       "platform",
		"POD_NAME":                    "controller-0",
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel.platform.svc:4317",
		"OTEL_TRACES_SAMPLER":         "parentbased_always_on",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "http://otel.platform.svc:4317", cfg.OTelEnv["OTEL_EXPORTER_OTLP_ENDPOINT"])
	assert.Equal(t, "parentbased_always_on", cfg.OTelEnv["OTEL_TRACES_SAMPLER"])
	assert.True(t, cfg.OTelEnabled())
}

func TestLoadFromEnv_OTelEnv_OnlyOtelPrefix(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":       "platform",
		"POD_NAME":                    "controller-0",
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel:4317",
	})
	t.Setenv("SOME_SECRET", "nope")
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	_, leaked := cfg.OTelEnv["SOME_SECRET"]
	assert.False(t, leaked)
}

func TestLoadFromEnv_OTelEnv_DisabledWhenNoEndpoint(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME": "platform",
		"POD_NAME":              "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.False(t, cfg.OTelEnabled())
}

func TestOTelExporter_Parsing(t *testing.T) {
	cases := []struct {
		raw, proto string
		want       OTLPExporter
		ok         bool
	}{
		{"", "", OTLPExporter{}, false},
		{"http://otel.platform.svc:4317", "", OTLPExporter{Host: "otel.platform.svc", Port: 4317, GRPC: true}, true},
		{"https://otel.example.com", "grpc", OTLPExporter{Host: "otel.example.com", Port: 4317, Secure: true, GRPC: true}, true},
		{"otel.platform.svc:4317", "", OTLPExporter{Host: "otel.platform.svc", Port: 4317, GRPC: true}, true},
		{"http://otel.platform.svc", "http/protobuf", OTLPExporter{Host: "otel.platform.svc", Port: 4318, GRPC: false}, true},
		{"https://otel.example.com:4318", "http/protobuf", OTLPExporter{Host: "otel.example.com", Port: 4318, Secure: true, GRPC: false}, true},
	}
	for _, tc := range cases {
		env := map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": tc.raw}
		if tc.proto != "" {
			env["OTEL_EXPORTER_OTLP_PROTOCOL"] = tc.proto
		}
		cfg := &Config{OTelEnv: env}
		got, ok := cfg.OTelExporter()
		assert.Equal(t, tc.ok, ok, tc.raw)
		if tc.ok {
			assert.Equal(t, tc.want, got, tc.raw)
		}
	}
}

func TestTraceSamplingPercent(t *testing.T) {
	cases := []struct {
		sampler, arg string
		want         float64
	}{
		{"", "", 100},
		{"always_on", "", 100},
		{"parentbased_always_off", "", 0},
		{"traceidratio", "0.1", 10},
		{"parentbased_traceidratio", "0.25", 25},
		{"", "0.5", 50},
		{"traceidratio", "9", 100},
		{"traceidratio", "bad", 100},
	}
	for _, tc := range cases {
		cfg := &Config{OTelEnv: map[string]string{
			"OTEL_TRACES_SAMPLER":     tc.sampler,
			"OTEL_TRACES_SAMPLER_ARG": tc.arg,
		}}
		assert.Equal(t, tc.want, cfg.TraceSamplingPercent(), "%s/%s", tc.sampler, tc.arg)
	}
}

func TestOTelExporter_GatewayOverrideWins(t *testing.T) {
	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":          "platform",
		"POD_NAME":                       "controller-0",
		"OTEL_EXPORTER_OTLP_ENDPOINT":    "http://collector:4318",
		"OTEL_EXPORTER_OTLP_PROTOCOL":    "http/protobuf",
		"PLATFORM_GATEWAY_OTLP_ENDPOINT": "http://collector:4317",
		"PLATFORM_GATEWAY_OTLP_PROTOCOL": "grpc",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	exp, ok := cfg.OTelExporter()
	require.True(t, ok)
	assert.True(t, exp.GRPC)
	assert.Equal(t, 4317, exp.Port)

	setEnv(t, map[string]string{
		"PLATFORM_RELEASE_NAME":          "platform",
		"POD_NAME":                       "controller-0",
		"PLATFORM_GATEWAY_OTLP_ENDPOINT": "http://collector:4317",
	})
	cfg, err = LoadFromEnv()
	require.NoError(t, err)
	assert.True(t, cfg.OTelEnabled(), "override alone must activate gateway telemetry")
	exp, ok = cfg.OTelExporter()
	require.True(t, ok)
	assert.True(t, exp.GRPC)
}
