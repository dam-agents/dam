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
	ReleaseNamespace string // Helm release namespace (where controller/OneCLI run)
	ReleaseName      string // Helm release name
	OneCLIURL        string // OneCLI web API base URL
	OneCLIAudience   string // OneCLI token audience (e.g. "onecli")
	GatewayHost      string // OneCLI gateway K8s service host (short name)
	GatewayPort      int    // OneCLI gateway port
	WebPort          int    // OneCLI web API port (for container-config endpoint)
	KeycloakTokenURL     string // Keycloak token endpoint for RFC 8693 exchange
	KeycloakClientID     string // Confidential client ID (e.g. humr-controller)
	KeycloakClientSecret string // Confidential client secret
	LeaseName        string // Leader election lease name
	PodName          string // This pod's name (from downward API)
	AgentImagePullPolicy      string            // ImagePullPolicy for agent pods (default: IfNotPresent)
	AgentImagePullSecrets     []string          // Pull secret names for agent pods (comma-separated via env)
	AgentPodAnnotations       map[string]string // Extra annotations stamped on every agent pod (e.g. admission webhook break-glass)
	AgentStorageClass         string
	AgentStorageSize          string // PVC size for persistent agent mounts (default: 10Gi)
	IdleTimeout               time.Duration // Idle timeout before auto-hibernation (0 = disabled, default: 1h)
	TerminationGracePeriod    int64         // Termination grace period in seconds for agent pods (default: 5)
	CACertInitImage      string // Image for the CA cert init container (default: busybox:stable)
	APIServerHost        string // API server hostname (for NO_PROXY)
	HarnessServerURL     string // Harness API server internal URL (separate port, agent-facing)
	HarnessServerPort    int    // Harness API server port (for network policy egress rule)
	EnvoyImage           string // Image for the Envoy credential-injector sidecar (experimental)
	EnvoyPort            int    // Port the Envoy sidecar listens on (proxy on 127.0.0.1)
	// EnvoyMitmCAIssuer is the cert-manager ClusterIssuer that mints per-instance
	// leaf certificates for the Envoy sidecar's TLS interception of agent egress.
	// Provisioned by the chart's cert-manager templates.
	EnvoyMitmCAIssuer        string
	EnvoyMitmLeafDuration    time.Duration // 0 = cert-manager default
	EnvoyMitmLeafRenewBefore time.Duration // 0 = cert-manager default
	AgentHome                string        // HOME inside agent containers. Used for the HOME env var on the agent pod.
	// ExtAuthzHost / ExtAuthzPort identify the API server's HITL ext_authz
	// listener (gRPC). Both Envoy filters use the same endpoint:
	//   - HTTP filter on TLS-terminated chains (L7 — sees method/path)
	//   - Network filter on the catch-all chain (L4 — SNI only)
	// (DRAFT-unified-hitl-ux).
	ExtAuthzHost string
	ExtAuthzPort int
	// ExtAuthzHoldSeconds bounds how long the ext_authz handler holds a single
	// call. Envoy's per-filter timeout must be at least this plus headroom.
	ExtAuthzHoldSeconds int
}

func LoadFromEnv() (*Config, error) {
	release := os.Getenv("HUMR_RELEASE_NAME")
	if release == "" {
		return nil, fmt.Errorf("required env var HUMR_RELEASE_NAME is not set")
	}

	podName := os.Getenv("POD_NAME")
	if podName == "" {
		return nil, fmt.Errorf("required env var POD_NAME is not set")
	}

	cfg := &Config{
		Namespace:        envOrDefault("HUMR_AGENT_NAMESPACE", "humr-agents"),
		ReleaseNamespace: envOrDefault("HUMR_RELEASE_NAMESPACE", "default"),
		ReleaseName:      release,
		OneCLIURL:            os.Getenv("ONECLI_URL"),
		OneCLIAudience:       envOrDefault("ONECLI_AUDIENCE", "onecli"),
		KeycloakTokenURL:     keycloakTokenURL(),
		KeycloakClientID:     envOrDefault("KEYCLOAK_CLIENT_ID", "humr-controller"),
		KeycloakClientSecret: os.Getenv("KEYCLOAK_CLIENT_SECRET"),
		GatewayHost:      envOrDefault("ONECLI_GATEWAY_HOST", release+"-onecli"),
		GatewayPort:      envOrDefaultInt("ONECLI_GATEWAY_PORT", 10255),
		WebPort:          envOrDefaultInt("ONECLI_WEB_PORT", 10254),
		LeaseName:        envOrDefault("HUMR_LEASE_NAME", release+"-controller"),
		PodName:          podName,
	}
	cfg.CACertInitImage = envOrDefault("CA_CERT_INIT_IMAGE", "busybox:stable")
	cfg.APIServerHost = os.Getenv("HUMR_API_SERVER_HOST")
	cfg.HarnessServerURL = os.Getenv("HUMR_HARNESS_SERVER_URL")
	cfg.HarnessServerPort = envOrDefaultInt("HUMR_HARNESS_SERVER_PORT", 4001)
	cfg.AgentImagePullPolicy = envOrDefault("AGENT_IMAGE_PULL_POLICY", "IfNotPresent")
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
	cfg.AgentStorageSize = envOrDefault("AGENT_STORAGE_SIZE", "10Gi")
	cfg.AgentHome = envOrDefault("AGENT_HOME", "/home/agent")
	cfg.IdleTimeout = envOrDefaultDuration("HUMR_IDLE_TIMEOUT", 1*time.Hour)
	cfg.TerminationGracePeriod = int64(envOrDefaultInt("HUMR_TERMINATION_GRACE_PERIOD", 5))
	cfg.EnvoyImage = envOrDefault("ENVOY_IMAGE", "envoyproxy/envoy:distroless-v1.37.2")
	cfg.EnvoyPort = envOrDefaultInt("ENVOY_PORT", 10000)
	cfg.EnvoyMitmCAIssuer = envOrDefault("ENVOY_MITM_CA_ISSUER", "humr-mitm-ca-issuer")
	cfg.EnvoyMitmLeafDuration = envOrDefaultDuration("ENVOY_MITM_LEAF_DURATION", 0)
	cfg.EnvoyMitmLeafRenewBefore = envOrDefaultDuration("ENVOY_MITM_LEAF_RENEW_BEFORE", 0)
	cfg.ExtAuthzHost = envOrDefault("EXT_AUTHZ_HOST", release+"-apiserver")
	cfg.ExtAuthzPort = envOrDefaultInt("EXT_AUTHZ_PORT", 4002)
	cfg.ExtAuthzHoldSeconds = envOrDefaultInt("EXT_AUTHZ_HOLD_SECONDS", 1800)
	return cfg, nil
}

// GatewayFQDN returns the fully-qualified DNS name for the OneCLI gateway service.
// Required because agent pods run in a different namespace than the gateway.
func (c *Config) GatewayFQDN() string {
	return fmt.Sprintf("%s.%s.svc.cluster.local", c.GatewayHost, c.ReleaseNamespace)
}

// WebURL returns the HTTP URL for the OneCLI web API (used by init containers to fetch CA cert).
func (c *Config) WebURL() string {
	return fmt.Sprintf("http://%s:%d", c.GatewayFQDN(), c.WebPort)
}

func (c *Config) APIServerURL() string {
	return fmt.Sprintf("http://%s-apiserver.%s.svc.cluster.local:%d", c.ReleaseName, c.ReleaseNamespace, c.HarnessServerPort)
}

func keycloakTokenURL() string {
	if v := os.Getenv("KEYCLOAK_TOKEN_URL"); v != "" {
		return v
	}
	base := os.Getenv("KEYCLOAK_URL")
	realm := envOrDefault("KEYCLOAK_REALM", "humr")
	if base == "" {
		return ""
	}
	return fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", base, realm)
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

func envOrDefaultDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
