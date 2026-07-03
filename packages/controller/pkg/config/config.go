package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/util/validation"
)

type Config struct {
	Namespace        string // Agent workload namespace
	ReleaseNamespace string // Helm release namespace (where controller runs)
	ReleaseName      string // Helm release name — used as the prefix for controller-rendered object names (matches `platform.fullname` in the chart). May differ from APIServerInstanceLabel when the chart name isn't contained in the release name.
	// APIServerInstanceLabel is the value of `app.kubernetes.io/instance` on
	// chart-rendered apiserver pods — i.e. the literal Helm `.Release.Name`.
	// Used to select apiserver pods from the per-instance ext-authz Service.
	// Diverges from `ReleaseName` (= `platform.fullname`) whenever the chart
	// name isn't a substring of the release name (e.g. release `dam`, chart
	// `platform` → fullname `dam-platform`, instance label `dam`).
	APIServerInstanceLabel string
	LeaseName              string // Leader election lease name
	PodName                string // This pod's name (from downward API)

	// AgentBase carries chart-only platform policy applied verbatim to every
	// controller-rendered agent / fork agent pod. Threaded in via the
	// AGENT_BASE env var from Helm `controller.agent.base`. Not overridable
	// by agent ConfigMaps.
	AgentBase AgentBase

	// AgentTemplateDefaults are chart-wide fallbacks used when an agent
	// template (or bare-image AgentSpec) omits a field. Threaded in via the
	// AGENT_TEMPLATE_DEFAULTS env var from `controller.agent.templateDefaults`.
	AgentTemplateDefaults AgentTemplateDefaults

	// WarmPool configures the pre-provisioned spare-PVC buffer (#692).
	// Threaded in via the WARM_POOL env var from `controller.warmPool`.
	// Disabled by default.
	WarmPool WarmPool

	AgentProbesEnabled       bool          // Render startup/readiness/liveness probes on agent pods (default: true; matches the chart's probes.enabled)
	HarnessServerURL         string        // Harness API server internal URL (separate port, agent-facing)
	HarnessServerPort        int           // Harness API server port (for network policy egress rule)
	EnvoyImage               string        // Image for the Envoy credential-injector sidecar
	EnvoyPort                int           // Port the Envoy sidecar listens on (proxy on 127.0.0.1)
	EnvoyMitmCAIssuer        string        // cert-manager ClusterIssuer that mints per-instance leaf certs for the Envoy sidecar's TLS interception
	EnvoyMitmLeafDuration    time.Duration // 0 = cert-manager default
	EnvoyMitmLeafRenewBefore time.Duration // 0 = cert-manager default
	// OTelEnv is the OpenTelemetry environment the controller inherited — every
	// `OTEL_*` variable in its own process env. The chart sets these under
	// `clickstack.enabled` (pointing at the bundled collector, the same env the
	// controller's own SDK reads); a BYO-collector deployment can inject them
	// instead (e.g. via the OpenTelemetry Operator). The controller relays them
	// onto gateway Envoy pods and parses the OTLP endpoint to point the
	// gateway's exporter at the same collector — the gateway is the one
	// component zero-code auto-instrumentation cannot reach (Envoy is a C++
	// data plane, not an app runtime), so the controller configures it natively
	// from this environment. Empty when instrumentation is off — gateways then
	// emit no telemetry.
	OTelEnv map[string]string
	// GatewayOTLPEndpoint/GatewayOTLPProtocol override the relayed OTEL_* pair
	// for the gateway exporter specifically. The chart sets them to the
	// bundled collector's gRPC endpoint under `clickstack.enabled` — gRPC
	// because Envoy's stats sink speaks nothing else — while the controller's
	// own SDK keeps its OTLP/HTTP env. Empty in BYO deployments, where the
	// inherited OTEL_* drive the gateway too.
	GatewayOTLPEndpoint string
	GatewayOTLPProtocol string
	// ExtAuthzPort identifies the API server's HITL ext_authz listener
	// (gRPC). Both Envoy filters use the same endpoint:
	//   - HTTP filter on TLS-terminated chains (L7 — sees method/path)
	//   - Network filter on the catch-all chain (L4 — SNI only)
	//
	// The host is per-instance (one Service per instance, named
	// `<release>-extauthz-<id>`, gated by AuthorizationPolicy to that
	// instance's SA principal). The gateway pod's Envoy bootstrap is
	// templated with its instance's per-instance ext-authz Service URL —
	// computed by ExtAuthzHostFor; there is no shared ExtAuthzHost.
	ExtAuthzPort int
	// ExtAuthzHoldSeconds bounds how long the ext_authz handler holds a single
	// call. Envoy's per-filter timeout must be at least this plus headroom.
	ExtAuthzHoldSeconds int
	// IstioTrustDomain is the SPIFFE trust domain configured for istiod
	// (default cluster.local). Used to render the per-instance principal
	// string `<td>/ns/<agent-ns>/sa/<id>` on AuthorizationPolicies.
	IstioTrustDomain string
	// IstioWaypointName is the name of the Gateway resource that fronts
	// the api-server's harness Service. Used in the harness-side
	// AuthorizationPolicy's targetRefs. Must match the Helm chart's
	// `istio.waypointName`.
	IstioWaypointName string
	// TelemetryCollectorHost is the in-cluster DNS of the platform OTLP
	// collector the gateway forwards agent telemetry to. Empty when the
	// telemetry backend is disabled; the chart sets it from
	// `clickstack.enabled`. When set, each gateway gains a collector egress
	// chain that stamps the trusted `x-platform-agent-id` header so the
	// collector can attribute telemetry to the producing instance.
	TelemetryCollectorHost string
	// TelemetryCollectorPort is the collector's OTLP/HTTP port (default 4318).
	TelemetryCollectorPort int
}

// otelEnvPrefix selects the OpenTelemetry environment family. The controller
// collects every variable with this prefix from its own process and relays
// them to gateway Envoy pods, so new OTel knobs flow through without the
// controller enumerating them.
const otelEnvPrefix = "OTEL_"

// collectOTelEnv snapshots the controller's OTEL_* environment.
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

// OTLPExporter is the parsed view of the inherited OTLP endpoint the gateway
// Envoy bootstrap needs. Secure (https scheme) and GRPC (transport) are
// orthogonal: an `http://host:4317` endpoint is plaintext OTLP/gRPC.
type OTLPExporter struct {
	Host   string
	Port   int
	Secure bool // https scheme → wrap the exporter cluster in upstream TLS
	GRPC   bool // OTLP/gRPC (true) vs OTLP/HTTP (false), from OTEL_EXPORTER_OTLP_PROTOCOL
}

// OTelEnabled reports whether the platform's OpenTelemetry instrumentation is
// active — i.e. the controller's environment carries an OTLP endpoint it can
// point gateway Envoys at. When false the gateway emits no telemetry. Distinct
// from TelemetryEnabled, which gates the agent-telemetry transit chain.
func (c *Config) OTelEnabled() bool {
	_, ok := c.OTelExporter()
	return ok
}

// OTelExporter resolves the exporter the gateway Envoy bootstrap targets.
// The gateway-specific PLATFORM_GATEWAY_OTLP_ENDPOINT/_PROTOCOL pair wins when
// set — the chart points it at the bundled collector's gRPC port, decoupled
// from the OTEL_* env the controller's own (OTLP/HTTP-only) SDK reads, so the
// two consumers never constrain each other's transport. Without the override
// the inherited OTEL_EXPORTER_OTLP_ENDPOINT/_PROTOCOL apply (the BYO case).
// ok is false when neither source names an endpoint.
func (c *Config) OTelExporter() (OTLPExporter, bool) {
	if exp, ok := parseOTLPExporter(c.GatewayOTLPEndpoint, c.GatewayOTLPProtocol); ok {
		return exp, true
	}
	return parseOTLPExporter(c.OTelEnv["OTEL_EXPORTER_OTLP_ENDPOINT"], c.OTelEnv["OTEL_EXPORTER_OTLP_PROTOCOL"])
}

// parseOTLPExporter parses an OTLP endpoint + protocol pair. Per the OTLP spec
// the endpoint is a URL; a bare host[:port] is tolerated. Port defaults to the
// OTLP convention for the transport (4317 gRPC, 4318 HTTP) when the URL omits
// it.
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

// otelUsesGRPC interprets OTEL_EXPORTER_OTLP_PROTOCOL. Unset defaults to gRPC —
// the OTLP spec default (port 4317) and the only transport Envoy's OTel stats
// sink supports. The http/* values select OTLP/HTTP.
func otelUsesGRPC(proto string) bool {
	switch strings.TrimSpace(strings.ToLower(proto)) {
	case "http/protobuf", "http/json", "http":
		return false
	default:
		return true
	}
}

// TraceSamplingPercent maps the inherited OTEL_TRACES_SAMPLER[/_ARG] onto the
// HCM `tracing.random_sampling` percentage Envoy actually honors — Envoy's
// native tracer ignores those env vars, so the controller translates them.
// always_on/off → 100/0; the *traceidratio samplers (or a bare _ARG) use the
// ARG ratio (0..1) ×100. Unset → 100 (full), matching Envoy's default and the
// canonical config; operators dial egress trace volume down via
// OTEL_TRACES_SAMPLER_ARG.
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
		if arg != "" { // a bare ARG with no named sampler is a ratio
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
		Namespace:        envOrDefault("PLATFORM_AGENT_NAMESPACE", "platform-agents"),
		ReleaseNamespace: envOrDefault("PLATFORM_RELEASE_NAMESPACE", "default"),
		ReleaseName:      release,
		// Defaults to ReleaseName so unit tests and older deployments that
		// don't set the var continue to behave as before; the chart always
		// sets it explicitly to `.Release.Name`.
		APIServerInstanceLabel: envOrDefault("PLATFORM_INSTANCE_LABEL", release),
		LeaseName:              envOrDefault("PLATFORM_LEASE_NAME", release+"-controller"),
		PodName:                podName,
	}

	// AGENT_BASE + AGENT_TEMPLATE_DEFAULTS — chart-only and template-fallback
	// JSON blobs. Defaults live in values.yaml (controller.agent.base and
	// controller.agent.templateDefaults), not here. DisallowUnknownFields
	// fails-loud on typos so the operator gets a clear startup error
	// instead of a silently-ignored field (e.g. `runtimeClasName` sic).
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
	// Relayed from the controller's own process: whatever OTEL_* the chart (or
	// an injector) set — the same env the controller's own SDK reads.
	cfg.OTelEnv = collectOTelEnv()
	cfg.GatewayOTLPEndpoint = os.Getenv("PLATFORM_GATEWAY_OTLP_ENDPOINT")
	cfg.GatewayOTLPProtocol = os.Getenv("PLATFORM_GATEWAY_OTLP_PROTOCOL")

	cfg.HarnessServerURL = os.Getenv("PLATFORM_HARNESS_SERVER_URL")
	cfg.HarnessServerPort = envOrDefaultInt("PLATFORM_HARNESS_SERVER_PORT", 4001)
	cfg.AgentProbesEnabled = envOrDefaultBool("AGENT_PROBES_ENABLED", true)
	// AGENT_HOME mirrors AgentTemplateDefaults.AgentHome for environments
	// that ship only the env var (e.g. tests). The chart's deployment.yaml
	// always sets both from the same `templateDefaults.agentHome` value;
	// the api-server gets its own AGENT_HOME env var directly.
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
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// validate fails-loud on missing/invalid chart values so the controller
// errors at startup with a clear pointer to the broken Helm field instead
// of panicking later inside the reconciler. Helm's bundled values.yaml
// always satisfies these; this guards against operators clearing fields
// (e.g. `--set controller.agent.templateDefaults.storageSize=""`).
func (c *Config) validate() error {
	if c.AgentBase.TerminationGracePeriod <= 0 {
		return fmt.Errorf("controller.agent.base.terminationGracePeriod must be > 0 (got %d)", c.AgentBase.TerminationGracePeriod)
	}
	if c.AgentBase.AccessMode == "" {
		return fmt.Errorf("controller.agent.base.accessMode is required")
	}
	if c.AgentTemplateDefaults.StorageSize == "" {
		return fmt.Errorf("controller.agent.templateDefaults.storageSize is required")
	}
	if _, err := resource.ParseQuantity(c.AgentTemplateDefaults.StorageSize); err != nil {
		return fmt.Errorf("controller.agent.templateDefaults.storageSize %q is not a valid K8s quantity: %w", c.AgentTemplateDefaults.StorageSize, err)
	}
	// Defense in depth: refuse to start if the container security context
	// floor was cleared. The chart ships `capabilities.drop: ["ALL"]`; if a
	// deployment clears it the operator hears about it at startup, not by
	// noticing privileged agent containers in prod.
	if c.AgentBase.ContainerSecurityContext == nil {
		return fmt.Errorf("controller.agent.base.containerSecurityContext is required (chart default ships capabilities.drop: [\"ALL\"])")
	}
	if err := c.WarmPool.validate(); err != nil {
		return err
	}
	return nil
}

// validate checks the warm-pool config only when it is enabled, so a default
// (disabled) deployment never trips these. Fails-loud on the operator-facing
// mistakes: a missing/empty Immediate-binding StorageClass, no sizes, an
// unparseable quantity, a size that can't be a label value, a duplicate size,
// or a negative target.
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

// APIServerURL is the harness Service URL, used by agent-runtime to dial
// MCP / pod-files / trigger endpoints. This points at the
// `-apiserver-harness` Service which carries the istio.io/use-waypoint
// label; in-mesh dials route through the waypoint where per-instance
// AuthorizationPolicies enforce principal == URL `:id`.
func (c *Config) APIServerURL() string {
	return fmt.Sprintf("http://%s-apiserver-harness.%s.svc.cluster.local:%d", c.ReleaseName, c.ReleaseNamespace, c.HarnessServerPort)
}

// ExtAuthzServiceName returns the name of the per-instance ext-authz
// Service the controller renders for `instanceID`. The gateway pod's
// Envoy bootstrap uses this name; the per-instance AuthorizationPolicy
// also targets it.
func (c *Config) ExtAuthzServiceName(instanceID string) string {
	return fmt.Sprintf("%s-extauthz-%s", c.ReleaseName, instanceID)
}

// ExtAuthzHostFor returns the FQDN of the per-instance ext-authz Service
// for `instanceID`. Used to template the gateway pod's Envoy bootstrap.
// The Service is gated by an AuthorizationPolicy keyed on
// the same SA principal, so a gateway pod can only successfully dial
// the Service for its own instance.
func (c *Config) ExtAuthzHostFor(instanceID string) string {
	return fmt.Sprintf("%s.%s.svc.cluster.local", c.ExtAuthzServiceName(instanceID), c.ReleaseNamespace)
}

// HarnessHost returns the bare hostname of the harness Service (no
// scheme, no port). Used as the gateway pod Envoy bootstrap's
// `:authority` match so harness traffic flows down a credential-injection-
// free route rather than the credentialed external-host chains.
func (c *Config) HarnessHost() string {
	return fmt.Sprintf("%s-apiserver-harness.%s.svc.cluster.local", c.ReleaseName, c.ReleaseNamespace)
}

// TelemetryEnabled reports whether the agent-telemetry backend is configured
// (collector host set by the chart from `clickstack.enabled`). When true, each
// gateway renders a collector egress chain that stamps the trusted agent id,
// and the leaf cert is issued (and mounted) even for an instance with no
// credential Secrets.
func (c *Config) TelemetryEnabled() bool { return c.TelemetryCollectorHost != "" }

// PrincipalFor returns the SPIFFE principal string for `instanceID`,
// matching how istiod stamps workload certs (`<td>/ns/<ns>/sa/<sa>`).
// Used to render the `from.source.principals` field on the per-instance
// AuthorizationPolicies.
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
