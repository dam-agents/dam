package config

import (
	"encoding/json"
	"fmt"
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
