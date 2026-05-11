package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
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
	LeaseName        string // Leader election lease name
	PodName          string // This pod's name (from downward API)
	AgentImagePullPolicy      string            // ImagePullPolicy for agent pods (default: IfNotPresent)
	AgentImagePullSecrets     []string          // Pull secret names for agent pods (comma-separated via env)
	AgentPodAnnotations       map[string]string // Extra annotations stamped on every agent pod (e.g. admission webhook break-glass)
	AgentProbesEnabled        bool              // Render startup/readiness/liveness probes on agent pods (default: true; matches the chart's probes.enabled)
	AgentStorageClass         string
	AgentAccessMode           string // PVC access mode: ReadWriteMany (default) or ReadWriteOnce
	AgentStorageSize          string // PVC size for persistent agent mounts (default: 10Gi)
	IdleTimeout               time.Duration // Idle timeout before auto-hibernation (0 = disabled, default: 1h)
	TerminationGracePeriod    int64         // Termination grace period in seconds for agent pods (default: 5)
	HarnessServerURL     string // Harness API server internal URL (separate port, agent-facing)
	HarnessServerPort    int    // Harness API server port (for network policy egress rule)
	EnvoyImage           string // Image for the Envoy credential-injector sidecar
	EnvoyPort            int    // Port the Envoy sidecar listens on (proxy on 127.0.0.1)
	// EnvoyMitmCAIssuer is the cert-manager ClusterIssuer that mints per-instance
	// leaf certificates for the Envoy sidecar's TLS interception of agent egress.
	// Provisioned by the chart's cert-manager templates.
	EnvoyMitmCAIssuer        string
	EnvoyMitmLeafDuration    time.Duration // 0 = cert-manager default
	EnvoyMitmLeafRenewBefore time.Duration // 0 = cert-manager default
	AgentHome                string        // HOME inside agent containers. Used for the HOME env var on the agent pod.
	// ExtAuthzPort identifies the API server's HITL ext_authz listener
	// (gRPC). Both Envoy filters use the same endpoint:
	//   - HTTP filter on TLS-terminated chains (L7 — sees method/path)
	//   - Network filter on the catch-all chain (L4 — SNI only)
	// (ADR-035).
	//
	// ADR-041: the host is per-instance (one Service per instance, named
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
		LeaseName:        envOrDefault("PLATFORM_LEASE_NAME", release+"-controller"),
		PodName:          podName,
	}
	cfg.HarnessServerURL = os.Getenv("PLATFORM_HARNESS_SERVER_URL")
	cfg.HarnessServerPort = envOrDefaultInt("PLATFORM_HARNESS_SERVER_PORT", 4001)
	cfg.AgentImagePullPolicy = envOrDefault("AGENT_IMAGE_PULL_POLICY", "IfNotPresent")
	cfg.AgentProbesEnabled = envOrDefaultBool("AGENT_PROBES_ENABLED", true)
	if v := os.Getenv("AGENT_IMAGE_PULL_SECRETS"); v != "" {
		for _, s := range strings.Split(v, ",") {
			if name := strings.TrimSpace(s); name != "" {
				cfg.AgentImagePullSecrets = append(cfg.AgentImagePullSecrets, name)
			}
		}
	}
	if v := os.Getenv("AGENT_POD_ANNOTATIONS"); v != "" {
		ann := map[string]string{}
		if err := json.Unmarshal([]byte(v), &ann); err != nil {
			return nil, fmt.Errorf("AGENT_POD_ANNOTATIONS: invalid JSON: %w", err)
		}
		cfg.AgentPodAnnotations = ann
	}
	cfg.AgentStorageClass = os.Getenv("AGENT_STORAGE_CLASS")
	cfg.AgentAccessMode = envOrDefault("AGENT_ACCESS_MODE", "ReadWriteMany")
	cfg.AgentStorageSize = envOrDefault("AGENT_STORAGE_SIZE", "10Gi")
	cfg.AgentHome = envOrDefault("AGENT_HOME", "/home/agent")
	cfg.IdleTimeout = envOrDefaultDuration("PLATFORM_IDLE_TIMEOUT", 1*time.Hour)
	cfg.TerminationGracePeriod = int64(envOrDefaultInt("PLATFORM_TERMINATION_GRACE_PERIOD", 5))
	cfg.EnvoyImage = envOrDefault("ENVOY_IMAGE", "envoyproxy/envoy:distroless-v1.37.2")
	cfg.EnvoyPort = envOrDefaultInt("ENVOY_PORT", 10000)
	cfg.EnvoyMitmCAIssuer = envOrDefault("ENVOY_MITM_CA_ISSUER", "platform-mitm-ca-issuer")
	cfg.EnvoyMitmLeafDuration = envOrDefaultDuration("ENVOY_MITM_LEAF_DURATION", 0)
	cfg.EnvoyMitmLeafRenewBefore = envOrDefaultDuration("ENVOY_MITM_LEAF_RENEW_BEFORE", 0)
	cfg.ExtAuthzPort = envOrDefaultInt("EXT_AUTHZ_PORT", 4002)
	cfg.ExtAuthzHoldSeconds = envOrDefaultInt("EXT_AUTHZ_HOLD_SECONDS", 1800)
	cfg.IstioTrustDomain = envOrDefault("PLATFORM_ISTIO_TRUST_DOMAIN", "cluster.local")
	cfg.IstioWaypointName = envOrDefault("PLATFORM_ISTIO_WAYPOINT_NAME", "apiserver-waypoint")
	return cfg, nil
}

// APIServerURL is the harness Service URL, used by agent-runtime to dial
// MCP / pod-files / trigger endpoints. ADR-041: this points at the
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
// for `instanceID`. Used to template the gateway pod's Envoy bootstrap
// (ADR-041). The Service is gated by an AuthorizationPolicy keyed on
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
