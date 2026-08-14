package config

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/util/validation"
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

	WarmPool WarmPool

	StorageMigration StorageMigration

	VM          VMConfig
	KubeAPIAddr string

	DefaultUserCPUBudget    resource.Quantity
	DefaultUserMemoryBudget resource.Quantity

	RequestsFraction  float64
	RequestsMinCPU    resource.Quantity
	RequestsMinMemory resource.Quantity

	LegacyAgentCPULimit    resource.Quantity
	LegacyAgentMemoryLimit resource.Quantity

	AgentProbesEnabled       bool
	HarnessServerURL         string
	HarnessServerPort        int
	EnvoyImage               string
	EnvoyPort                int
	EnvoyMitmCAIssuer        string
	EnvoyMitmLeafDuration    time.Duration
	EnvoyMitmLeafRenewBefore time.Duration
	OTelEnv                  map[string]string
	GatewayOTLPEndpoint      string
	GatewayOTLPProtocol      string
	ExtAuthzPort             int
	ExtAuthzHoldSeconds      int
	IstioTrustDomain         string
	IstioWaypointName        string
	TelemetryCollectorHost   string
	TelemetryCollectorPort   int
	ObjectStoreHost          string
	ObjectStorePort          int
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
			return clampPercent(v * 100)
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

func clampPercent(p float64) float64 {
	switch {
	case p < 0:
		return 0
	case p > 100:
		return 100
	default:
		return p
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

	if v := os.Getenv("AGENT_BASE"); v != "" {
		dec := json.NewDecoder(strings.NewReader(v))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&cfg.AgentBase); err != nil {
			return nil, fmt.Errorf("AGENT_BASE: invalid JSON: %w", err)
		}
	}
	if v := os.Getenv("AGENT_TEMPLATE_DEFAULTS"); v != "" {
		dec := json.NewDecoder(strings.NewReader(v))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&cfg.AgentTemplateDefaults); err != nil {
			return nil, fmt.Errorf("AGENT_TEMPLATE_DEFAULTS: invalid JSON: %w", err)
		}
	}
	if v := os.Getenv("WARM_POOL"); v != "" {
		dec := json.NewDecoder(strings.NewReader(v))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&cfg.WarmPool); err != nil {
			return nil, fmt.Errorf("WARM_POOL: invalid JSON: %w", err)
		}
	}
	if cfg.AgentBase.AccessMode != "" {
		slog.Warn("controller.agent.base.accessMode is deprecated and ignored — workspace volumes are always ReadWriteOnce (#2988); remove it from your values")
	}
	if v := os.Getenv("STORAGE_MIGRATION"); v != "" {
		dec := json.NewDecoder(strings.NewReader(v))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&cfg.StorageMigration); err != nil {
			return nil, fmt.Errorf("STORAGE_MIGRATION: invalid JSON: %w", err)
		}
	}
	if v := os.Getenv("AGENT_VM"); v != "" {
		dec := json.NewDecoder(strings.NewReader(v))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&cfg.VM); err != nil {
			return nil, fmt.Errorf("AGENT_VM: invalid JSON: %w", err)
		}
	}
	if cfg.VM.ScratchSize == "" {
		cfg.VM.ScratchSize = "30Gi"
	} else if _, err := resource.ParseQuantity(cfg.VM.ScratchSize); err != nil {
		return nil, fmt.Errorf("AGENT_VM: invalid scratchSize %q: %w", cfg.VM.ScratchSize, err)
	}
	if h := os.Getenv("KUBERNETES_SERVICE_HOST"); h != "" {
		cfg.KubeAPIAddr = net.JoinHostPort(h, envOrDefault("KUBERNETES_SERVICE_PORT", "443"))
	}
	cfg.OTelEnv = collectOTelEnv()
	cfg.GatewayOTLPEndpoint = os.Getenv("PLATFORM_GATEWAY_OTLP_ENDPOINT")
	cfg.GatewayOTLPProtocol = os.Getenv("PLATFORM_GATEWAY_OTLP_PROTOCOL")

	cfg.HarnessServerURL = os.Getenv("PLATFORM_HARNESS_SERVER_URL")
	cfg.HarnessServerPort = envOrDefaultInt("PLATFORM_HARNESS_SERVER_PORT", 4001)
	cfg.AgentProbesEnabled = envOrDefaultBool("AGENT_PROBES_ENABLED", true)
	if cfg.AgentTemplateDefaults.AgentHome == "" {
		cfg.AgentTemplateDefaults.AgentHome = envOrDefault("AGENT_HOME", "/home/agent")
	}
	cfg.EnvoyImage = envOrDefault("ENVOY_IMAGE", "mirror.gcr.io/envoyproxy/envoy:distroless-v1.37.2")
	cfg.EnvoyPort = envOrDefaultInt("ENVOY_PORT", 10000)
	cfg.EnvoyMitmCAIssuer = envOrDefault("ENVOY_MITM_CA_ISSUER", "platform-mitm-ca-issuer")
	cfg.EnvoyMitmLeafDuration = envOrDefaultDuration("ENVOY_MITM_LEAF_DURATION", 0)
	cfg.EnvoyMitmLeafRenewBefore = envOrDefaultDuration("ENVOY_MITM_LEAF_RENEW_BEFORE", 0)
	cfg.ExtAuthzPort = envOrDefaultInt("EXT_AUTHZ_PORT", 4002)
	cfg.ExtAuthzHoldSeconds = envOrDefaultInt("EXT_AUTHZ_HOLD_SECONDS", 1800)
	cfg.IstioTrustDomain = envOrDefault("PLATFORM_ISTIO_TRUST_DOMAIN", "cluster.local")
	cfg.IstioWaypointName = envOrDefault("PLATFORM_ISTIO_WAYPOINT_NAME", "apiserver-waypoint")
	cfg.TelemetryCollectorHost = os.Getenv("PLATFORM_TELEMETRY_COLLECTOR_HOST")
	cfg.TelemetryCollectorPort = envOrDefaultInt("PLATFORM_TELEMETRY_COLLECTOR_PORT", 4318)
	cpuBudget, err := resource.ParseQuantity(envOrDefault("DEFAULT_USER_CPU_BUDGET", "4"))
	if err != nil {
		return nil, fmt.Errorf("DEFAULT_USER_CPU_BUDGET is not a valid K8s quantity: %w", err)
	}
	memBudget, err := resource.ParseQuantity(envOrDefault("DEFAULT_USER_MEMORY_BUDGET", "8Gi"))
	if err != nil {
		return nil, fmt.Errorf("DEFAULT_USER_MEMORY_BUDGET is not a valid K8s quantity: %w", err)
	}
	cfg.DefaultUserCPUBudget = cpuBudget
	cfg.DefaultUserMemoryBudget = memBudget
	fraction, err := strconv.ParseFloat(envOrDefault("REQUESTS_FROM_LIMITS_FRACTION", "0.5"), 64)
	if err != nil || fraction <= 0 || fraction > 1 {
		return nil, fmt.Errorf("REQUESTS_FROM_LIMITS_FRACTION must be a number in (0, 1] (got %q)", os.Getenv("REQUESTS_FROM_LIMITS_FRACTION"))
	}
	minCPU, err := resource.ParseQuantity(envOrDefault("REQUESTS_FROM_LIMITS_MIN_CPU", "100m"))
	if err != nil {
		return nil, fmt.Errorf("REQUESTS_FROM_LIMITS_MIN_CPU is not a valid K8s quantity: %w", err)
	}
	minMemory, err := resource.ParseQuantity(envOrDefault("REQUESTS_FROM_LIMITS_MIN_MEMORY", "128Mi"))
	if err != nil {
		return nil, fmt.Errorf("REQUESTS_FROM_LIMITS_MIN_MEMORY is not a valid K8s quantity: %w", err)
	}
	cfg.RequestsFraction = fraction
	cfg.RequestsMinCPU = minCPU
	cfg.RequestsMinMemory = minMemory
	legacyCPU, err := resource.ParseQuantity(envOrDefault("AGENT_LEGACY_CPU_LIMIT", "1"))
	if err != nil {
		return nil, fmt.Errorf("AGENT_LEGACY_CPU_LIMIT is not a valid K8s quantity: %w", err)
	}
	legacyMem, err := resource.ParseQuantity(envOrDefault("AGENT_LEGACY_MEMORY_LIMIT", "2Gi"))
	if err != nil {
		return nil, fmt.Errorf("AGENT_LEGACY_MEMORY_LIMIT is not a valid K8s quantity: %w", err)
	}
	cfg.LegacyAgentCPULimit = legacyCPU
	cfg.LegacyAgentMemoryLimit = legacyMem
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
	if c.AgentBase.TerminationGracePeriod <= 0 {
		return fmt.Errorf("controller.agent.base.terminationGracePeriod must be > 0 (got %d)", c.AgentBase.TerminationGracePeriod)
	}
	if c.AgentTemplateDefaults.StorageSize == "" {
		return fmt.Errorf("controller.agent.templateDefaults.storageSize is required")
	}
	if _, err := resource.ParseQuantity(c.AgentTemplateDefaults.StorageSize); err != nil {
		return fmt.Errorf("controller.agent.templateDefaults.storageSize %q is not a valid K8s quantity: %w", c.AgentTemplateDefaults.StorageSize, err)
	}
	if r := c.AgentTemplateDefaults.Resources; r == nil || r.Limits.Cpu().IsZero() || r.Limits.Memory().IsZero() {
		return fmt.Errorf("controller.agent.templateDefaults.resources.limits must set cpu and memory (the default agent size and the budget fallback for legacy specs)")
	}
	if c.AgentBase.ContainerSecurityContext == nil {
		return fmt.Errorf("controller.agent.base.containerSecurityContext is required (chart default ships capabilities.drop: [\"ALL\"])")
	}
	if err := c.WarmPool.validate(); err != nil {
		return err
	}
	if c.StorageMigration.Enabled && c.StorageMigration.JobImage == "" {
		return fmt.Errorf("controller.storageMigration.jobImage is required when the storage migration is enabled")
	}
	return nil
}

func (w *WarmPool) validate() error {
	if !w.Enabled {
		return nil
	}
	if w.StorageClass == "" {
		return fmt.Errorf("controller.warmPool.storageClass is required when the warm pool is enabled (must be an Immediate-binding StorageClass)")
	}
	if len(w.Sizes) == 0 {
		return fmt.Errorf("controller.warmPool.sizes must list at least one {size, target} when the warm pool is enabled")
	}
	seen := make(map[string]bool, len(w.Sizes))
	for i, s := range w.Sizes {
		q, err := resource.ParseQuantity(s.Size)
		if err != nil {
			return fmt.Errorf("controller.warmPool.sizes[%d].size %q is not a valid K8s quantity: %w", i, s.Size, err)
		}
		if s.Target < 0 {
			return fmt.Errorf("controller.warmPool.sizes[%d].target must be >= 0 (got %d)", i, s.Target)
		}
		canon := q.String()
		if errs := validation.IsValidLabelValue(canon); len(errs) > 0 {
			return fmt.Errorf("controller.warmPool.sizes[%d].size %q canonicalizes to %q, not a valid label value: %s", i, s.Size, canon, strings.Join(errs, "; "))
		}
		if seen[canon] {
			return fmt.Errorf("controller.warmPool.sizes[%d].size %q duplicates another entry (both canonicalize to %q)", i, s.Size, canon)
		}
		seen[canon] = true
	}
	return nil
}

func (c *Config) APIServerURL() string {
	return fmt.Sprintf("http://%s-apiserver-harness.%s.svc.cluster.local:%d", c.ReleaseName, c.ReleaseNamespace, c.HarnessServerPort)
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

func envOrDefaultBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func envOrDefaultDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
