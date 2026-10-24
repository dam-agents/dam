package config

import (
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"

	"k8s.io/apimachinery/pkg/api/resource"
)

type Config struct {
	Namespace              string
	ReleaseNamespace       string
	ReleaseName            string
	APIServerInstanceLabel string
	LeaseName              string
	PodName                string

	AgentBase AgentBase

	AgentTemplateDefaults AgentTemplateDefaults

	VM          VMConfig
	KubeAPIAddr string

	DefaultUserCPUBudget    resource.Quantity
	DefaultUserMemoryBudget resource.Quantity

	LegacyAgentCPULimit    resource.Quantity
	LegacyAgentMemoryLimit resource.Quantity

	HarnessServerURL       string
	HarnessServerPort      int
	EnvoyImage             string
	MachineDNSImage        string
	EnvoyPort              int
	EnvoyMitmCAIssuer      string
	VMRunnerCAIssuer       string
	OTelEnv                map[string]string
	GatewayOTLPEndpoint    string
	GatewayOTLPProtocol    string
	ExtAuthzPort           int
	ExtAuthzHoldSeconds    int
	IstioTrustDomain       string
	IstioWaypointName      string
	TelemetryCollectorHost string
	TelemetryCollectorPort int
	ObjectStoreHost        string
	ObjectStorePort        int

	GatewayUpstreamTrustBundle string
	ExtraTrustedCAs            string
	GatewayEgress              GatewayEgress
}

const otelEnvPrefix = "OTEL_"

func collectOTelEnv() map[string]string {
	out := map[string]string{}
	for _, kv := range os.Environ() {
		eq := strings.IndexByte(kv, '=')
		if eq < 0 {
			continue
		}
		if key := kv[:eq]; strings.HasPrefix(key, otelEnvPrefix) {
			out[key] = kv[eq+1:]
		}
	}
	return out
}

type OTLPExporter struct {
	Host   string
	Port   int
	Secure bool
	GRPC   bool
}

func (c *Config) OTelEnabled() bool {
	_, ok := c.OTelExporter()
	return ok
}

func (c *Config) OTelExporter() (OTLPExporter, bool) {
	if exp, ok := parseOTLPExporter(c.GatewayOTLPEndpoint, c.GatewayOTLPProtocol); ok {
		return exp, true
	}
	return parseOTLPExporter(c.OTelEnv["OTEL_EXPORTER_OTLP_ENDPOINT"], c.OTelEnv["OTEL_EXPORTER_OTLP_PROTOCOL"])
}

func parseOTLPExporter(endpoint, protocol string) (OTLPExporter, bool) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return OTLPExporter{}, false
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return OTLPExporter{}, false
	}
	exp := OTLPExporter{
		Host:   u.Hostname(),
		Secure: u.Scheme == "https",
		GRPC:   otelUsesGRPC(protocol),
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			exp.Port = n
		}
	}
	if exp.Port == 0 {
		if exp.GRPC {
			exp.Port = 4317
		} else {
			exp.Port = 4318
		}
	}
	return exp, true
}

func otelUsesGRPC(proto string) bool {
	switch strings.TrimSpace(strings.ToLower(proto)) {
	case "http/protobuf", "http/json", "http":
		return false
	default:
		return true
	}
}

func (c *Config) TraceSamplingPercent() float64 {
	sampler := strings.TrimSpace(strings.ToLower(c.OTelEnv["OTEL_TRACES_SAMPLER"]))
	arg := strings.TrimSpace(c.OTelEnv["OTEL_TRACES_SAMPLER_ARG"])
	ratioArg := func() float64 {
		if v, err := strconv.ParseFloat(arg, 64); err == nil {
			return min(max(v*100, 0), 100)
		}
		return 100
	}
	switch sampler {
	case "always_off", "parentbased_always_off":
		return 0
	case "always_on", "parentbased_always_on":
		return 100
	case "traceidratio", "parentbased_traceidratio":
		return ratioArg()
	case "":
		if arg != "" {
			return ratioArg()
		}
		return 100
	default:
		return 100
	}
}

func LoadFromEnv() (*Config, error) {
	release := os.Getenv("PLATFORM_RELEASE_NAME")
	if release == "" {
		return nil, fmt.Errorf("required env var PLATFORM_RELEASE_NAME is not set")
	}

	podName := os.Getenv("POD_NAME")
	if podName == "" {
		return nil, fmt.Errorf("required env var POD_NAME is not set")
	}

	cfg := &Config{
		Namespace:              envOrDefault("PLATFORM_AGENT_NAMESPACE", "platform-agents"),
		ReleaseNamespace:       envOrDefault("PLATFORM_RELEASE_NAMESPACE", "default"),
		ReleaseName:            release,
		APIServerInstanceLabel: envOrDefault("PLATFORM_INSTANCE_LABEL", release),
		LeaseName:              envOrDefault("PLATFORM_LEASE_NAME", release+"-controller"),
		PodName:                podName,
	}

	if err := decodeJSONEnv("AGENT_BASE", &cfg.AgentBase); err != nil {
		return nil, err
	}
	if err := decodeJSONEnv("AGENT_TEMPLATE_DEFAULTS", &cfg.AgentTemplateDefaults); err != nil {
		return nil, err
	}
	if err := decodeJSONEnv("AGENT_VM", &cfg.VM); err != nil {
		return nil, err
	}
	if err := decodeJSONEnv("GATEWAY_EGRESS", &cfg.GatewayEgress); err != nil {
		return nil, err
	}
	for _, c := range cfg.GatewayEgress.ExtraCIDRs {
		if _, err := netip.ParsePrefix(c); err != nil {
			return nil, fmt.Errorf("GATEWAY_EGRESS: extraCidrs entry %q is not a CIDR: %w", c, err)
		}
	}
	for i, p := range cfg.GatewayEgress.Peers {
		if p.Namespace == "" || len(p.Ports) == 0 {
			return nil, fmt.Errorf("GATEWAY_EGRESS: peers[%d] needs a namespace and at least one port — without ports it would open every port", i)
		}
		if len(p.PodLabels) == 0 {
			return nil, fmt.Errorf("GATEWAY_EGRESS: peers[%d] needs podLabels — without them it would open every pod in namespace %q", i, p.Namespace)
		}
		for _, port := range p.Ports {
			if port < 1 || port > 65535 {
				return nil, fmt.Errorf("GATEWAY_EGRESS: peers[%d] port %d is out of range", i, port)
			}
		}
	}
	if cfg.VM.Runner.Image == "" || cfg.VM.Runner.Storage == "" {
		return nil, fmt.Errorf("AGENT_VM: runner.image and runner.storage are required")
	}
	if cfg.VM.Runner.Resources == nil || cfg.VM.Runner.Resources.Limits.Memory().IsZero() {
		return nil, fmt.Errorf("AGENT_VM: runner.resources.limits.memory is required — the runner admits machines against it, and without one it reads the node's allocatable")
	}
	if cfg.VM.Runner.HostAddress == "" && cfg.VM.Runner.ReleaseHostPath == "" {
		return nil, fmt.Errorf("AGENT_VM: runner.releaseHostPath is required — a new runner image reaches the runner pods only as a hand-off from there")
	}
	if cfg.VM.Runner.Rollout.MaxConcurrent < 0 {
		return nil, fmt.Errorf("AGENT_VM: runner.rollout.maxConcurrent is %d, it must not be negative", cfg.VM.Runner.Rollout.MaxConcurrent)
	}
	if pct := cfg.VM.Runner.Rollout.MaxConcurrentPercent; pct < 0 || pct > 100 {
		return nil, fmt.Errorf("AGENT_VM: runner.rollout.maxConcurrentPercent is %d, it must be between 0 and 100, where 0 leaves the width to maxConcurrent", pct)
	}
	if d := cfg.VM.Runner.Rollout.StalledTimeout; d < 0 {
		return nil, fmt.Errorf("AGENT_VM: runner.rollout.stalledTimeout is %s, it must not be negative", d.AsDuration())
	}
	if h := os.Getenv("KUBERNETES_SERVICE_HOST"); h != "" {
		cfg.KubeAPIAddr = net.JoinHostPort(h, envOrDefault("KUBERNETES_SERVICE_PORT", "443"))
	}
	cfg.OTelEnv = collectOTelEnv()
	cfg.GatewayOTLPEndpoint = os.Getenv("PLATFORM_GATEWAY_OTLP_ENDPOINT")
	cfg.GatewayOTLPProtocol = os.Getenv("PLATFORM_GATEWAY_OTLP_PROTOCOL")

	cfg.HarnessServerURL = os.Getenv("PLATFORM_HARNESS_SERVER_URL")
	cfg.HarnessServerPort = envOrDefaultInt("PLATFORM_HARNESS_SERVER_PORT", 4001)
	cfg.EnvoyImage = envOrDefault("ENVOY_IMAGE", "mirror.gcr.io/envoyproxy/envoy:distroless-v1.39.4")
	cfg.MachineDNSImage = envOrDefault("MACHINE_DNS_IMAGE", "mirror.gcr.io/coredns/coredns:1.14.7")
	cfg.EnvoyPort = envOrDefaultInt("ENVOY_PORT", 10000)
	cfg.EnvoyMitmCAIssuer = envOrDefault("ENVOY_MITM_CA_ISSUER", "platform-mitm-ca-issuer")
	cfg.VMRunnerCAIssuer = envOrDefault("VM_RUNNER_CA_ISSUER", "platform-vm-runner-ca-issuer")
	cfg.ExtAuthzPort = envOrDefaultInt("EXT_AUTHZ_PORT", 4002)
	cfg.ExtAuthzHoldSeconds = envOrDefaultInt("EXT_AUTHZ_HOLD_SECONDS", 1800)
	cfg.IstioTrustDomain = envOrDefault("PLATFORM_ISTIO_TRUST_DOMAIN", "cluster.local")
	cfg.IstioWaypointName = envOrDefault("PLATFORM_ISTIO_WAYPOINT_NAME", "apiserver-waypoint")
	cfg.TelemetryCollectorHost = os.Getenv("PLATFORM_TELEMETRY_COLLECTOR_HOST")
	cfg.TelemetryCollectorPort = envOrDefaultInt("PLATFORM_TELEMETRY_COLLECTOR_PORT", 4318)
	if extra := os.Getenv("PLATFORM_GATEWAY_UPSTREAM_EXTRA_CAS"); strings.TrimSpace(extra) != "" {
		extras, err := ExtraTrustedCAs(extra)
		if err != nil {
			return nil, fmt.Errorf("PLATFORM_GATEWAY_UPSTREAM_EXTRA_CAS: %w", err)
		}
		bundle, err := GatewayUpstreamTrustBundle(systemCABundle, extras)
		if err != nil {
			return nil, fmt.Errorf("PLATFORM_GATEWAY_UPSTREAM_EXTRA_CAS: %w", err)
		}
		cfg.GatewayUpstreamTrustBundle = bundle
		cfg.ExtraTrustedCAs = extras
	}
	for _, q := range []struct {
		dst      *resource.Quantity
		key, def string
	}{
		{&cfg.DefaultUserCPUBudget, "DEFAULT_USER_CPU_BUDGET", "4"},
		{&cfg.DefaultUserMemoryBudget, "DEFAULT_USER_MEMORY_BUDGET", "8Gi"},
		{&cfg.LegacyAgentCPULimit, "AGENT_LEGACY_CPU_LIMIT", "1"},
		{&cfg.LegacyAgentMemoryLimit, "AGENT_LEGACY_MEMORY_LIMIT", "2Gi"},
	} {
		v, err := resource.ParseQuantity(envOrDefault(q.key, q.def))
		if err != nil {
			return nil, fmt.Errorf("%s is not a valid K8s quantity: %w", q.key, err)
		}
		*q.dst = v
	}
	if v := os.Getenv("PLATFORM_OBJECT_STORE_AUTHORITY"); v != "" {
		host, port, err := net.SplitHostPort(v)
		if err != nil {
			return nil, fmt.Errorf("PLATFORM_OBJECT_STORE_AUTHORITY must be host:port, got %q: %w", v, err)
		}
		p, err := strconv.Atoi(port)
		if err != nil {
			return nil, fmt.Errorf("PLATFORM_OBJECT_STORE_AUTHORITY port must be numeric, got %q", port)
		}
		cfg.ObjectStoreHost = host
		cfg.ObjectStorePort = p
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	if c.AgentTemplateDefaults.StorageSize == "" {
		return fmt.Errorf("controller.agent.templateDefaults.storageSize is required")
	}
	if _, err := resource.ParseQuantity(c.AgentTemplateDefaults.StorageSize); err != nil {
		return fmt.Errorf("controller.agent.templateDefaults.storageSize %q is not a valid K8s quantity: %w", c.AgentTemplateDefaults.StorageSize, err)
	}
	if r := c.AgentTemplateDefaults.Resources; r == nil || r.Limits.Cpu().IsZero() || r.Limits.Memory().IsZero() {
		return fmt.Errorf("controller.agent.templateDefaults.resources.limits must set cpu and memory (the default agent size and the budget fallback for legacy specs)")
	}
	return nil
}

func (c *Config) ExtAuthzServiceName(instanceID string) string {
	return fmt.Sprintf("%s-extauthz-%s", c.ReleaseName, instanceID)
}

func (c *Config) ExtAuthzHostFor(instanceID string) string {
	return fmt.Sprintf("%s.%s.svc.cluster.local", c.ExtAuthzServiceName(instanceID), c.ReleaseNamespace)
}

func (c *Config) HarnessHost() string {
	return fmt.Sprintf("%s-apiserver-harness.%s.svc.cluster.local", c.ReleaseName, c.ReleaseNamespace)
}

func (c *Config) TelemetryEnabled() bool { return c.TelemetryCollectorHost != "" }

func (c *Config) PrincipalFor(instanceID string) string {
	return fmt.Sprintf("%s/ns/%s/sa/%s", c.IstioTrustDomain, c.Namespace, instanceID)
}

func decodeJSONEnv(key string, dst any) error {
	v := os.Getenv(key)
	if v == "" {
		return nil
	}
	dec := json.NewDecoder(strings.NewReader(v))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("%s: invalid JSON: %w", key, err)
	}
	return nil
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrDefaultInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
