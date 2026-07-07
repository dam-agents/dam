package reconciler

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"text/template"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Envoy sidecar wiring for the experimental credential-injector path.
//
// Scope of #337: Envoy proxies all egress for the agent container. Per-Secret
// routes inject a credential under the configured header for the matching host.
// The credential file content is produced by the api-server's K8sSecretsPort
// (which bakes any header prefix into the file) and read verbatim by Envoy's
// generic credential source. SDS hot-reload picks up file changes without a
// restart; topology changes (new/removed Secrets, host edits) regenerate the
// bootstrap ConfigMap and roll the StatefulSet.

const (
	envoyOwnerLabel      = "agent-platform.ai/owner"
	envoyManagedByLabel  = "agent-platform.ai/managed-by"
	envoySecretTypeLabel = "agent-platform.ai/secret-type"
	envoyConnectionLabel = "agent-platform.ai/connection"
	// Non-connection Secrets: single injection target via these.
	envoyHostPatternAnn = "agent-platform.ai/host-pattern"
	envoyHeaderNameAnn  = "agent-platform.ai/injection-header-name"
	envoyQueryParamAnn  = "agent-platform.ai/injection-query-param"
	envoyAuthModeAnn    = "agent-platform.ai/auth-mode"
	// Opt-in HTTP/2 chain so credential injection covers a gRPC stream (Modal).
	envoyInjectionHTTP2Ann = "agent-platform.ai/injection-http2"
	// Connection Secrets: N injection targets as JSON. Issue #219. (The
	// api-server also stamps `agent-platform.ai/host-patterns` for kubectl
	// readability; the controller doesn't read it.)
	envoyInjectionHostsAnn = "agent-platform.ai/injection-hosts"
	// JSON-encoded list of {envName, placeholder} the api-server stamps on a
	// user-typed credential Secret. Authoritative source for the env vars
	// the agent harness needs as placeholders. Connection-type
	// Secrets do not write this annotation today and fall through to the
	// hardcoded mapping in `credentialEnvVars` below.
	envoyEnvMappingsAnn        = "agent-platform.ai/env-mappings"
	credentialSecretNamePrefix = "platform-cred-"
	envoyBootstrapVolume       = "envoy-bootstrap"
	envoyBootstrapMount        = "/etc/envoy"
	envoyCredentialsRoot       = "/etc/envoy/credentials"
	envoyCredentialKeySDS      = "sds.yaml"   // SDS DiscoveryResponse file (expected by path_config_source)
	envoyCredentialSDSName     = "credential" // SDS resource name produced by api-server's K8sSecretsPort
	envoyLeafTLSVolume         = "envoy-tls"
	envoyLeafTLSMount          = "/etc/envoy/tls"
)

// EnvoyBootstrapName returns the per-instance ConfigMap name carrying the
// Envoy bootstrap YAML.
func EnvoyBootstrapName(instanceName string) string {
	return instanceName + "-envoy-bootstrap"
}

// envoyCredential is one injection step in a host's filter chain. Each
// (Secret, host) pair renders to one of these; multiple credentials
// pointing at the same host stack inside a single `envoyHostChain` so
// users can express "two injections on the same endpoint" by stacking
// two Secrets or two host entries in one connection Secret.
type envoyCredential struct {
	SecretName string // K8s Secret name, used for diagnostics + ChainID derivation
	HeaderName string // header credential_injector writes into
	// When non-empty, a Lua filter after credential_injector moves the
	// injected header value into this URL query parameter and strips the
	// header before the request leaves the sidecar. Used for APIs that
	// read the credential from the URL. The Secret's SDS file stores the
	// raw value in that case so the URL doesn't grow a `Bearer ` prefix.
	QueryParamName string
	VolumeName     string // pod-level volume name for this Secret
	// SDS file key inside the Secret's volume. Single-host
	// Secrets use `sds.yaml`; connection Secrets use the api-server's
	// `sdsKey` (host-<base64url>.sds.yaml) so one Secret carries N
	// chains' credentials (issue #219).
	SDSFileKey string
}

// envoyHostChain is one TLS-terminating filter chain. `Credentials` is
// the per-Secret injection list applied to every request through the
// chain, in deterministic order (Secrets are name-sorted upstream). Empty
// `Credentials` is the allow-only / MITM-only flavor: the host
// has at least one path-specific egress_rule but no attached credential —
// we still terminate TLS for the gate but skip credential_injector.
type envoyHostChain struct {
	// Chain identifier — used as Envoy `name:` and stat_prefix. Must be
	// unique across all chains in the listener; derived from the first
	// Secret's name so the chain is stable across reconciles (granting
	// an extra Secret on the same host adds a credential to an existing
	// chain instead of renaming it).
	ChainID string
	// Host the chain terminates TLS for (SNI match).
	Host string
	// Per-credential injection steps, in name-sorted order.
	Credentials []envoyCredential
	// Name of the per-chain STRICT_DNS upstream cluster used when the
	// chain has at least one credential. Pinned to `Host:443` with
	// SAN-bound TLS validation so the agent's Host header cannot
	// redirect the credentialed body to an attacker-controlled upstream.
	UpstreamCluster string
	HTTP2           bool
}

// Credentialed reports whether the chain has any credential injections.
// Allow-only chains (no credentials) skip credential_injector and forward
// via dynamic_forward_proxy — there's no credential to misroute.
func (c envoyHostChain) Credentialed() bool { return len(c.Credentials) > 0 }

// HasQueryParamCredential reports whether any credential on the chain is
// moved into a URL query parameter. Such chains must stay untraced: the
// post-injection :path carries the credential and Envoy has no
// query-stripper for span tags.
func (c envoyHostChain) HasQueryParamCredential() bool {
	for _, cred := range c.Credentials {
		if cred.QueryParamName != "" {
			return true
		}
	}
	return false
}

// envoySecretTypeAllowOnly marks Secrets that exist solely to extend the
// cert SAN list and force a host onto the L7 path so path-specific egress
// rules can be enforced. They carry no credential payload.
const envoySecretTypeAllowOnly = "allow-only"

// listAgentCredentialSecrets returns the owner's credential Secrets filtered
// by the agent's grants. Grants moved from ConfigMap annotations into
// the Agent spec (grantedSecretIds / grantedConnectionIds); they arrive here as
// the typed slices off that spec. See `filterByGrants` for the semantics.
func listAgentCredentialSecrets(ctx context.Context, client kubernetes.Interface, namespace, owner string, grantedSecretIDs, grantedConnectionIDs []string) ([]corev1.Secret, error) {
	all, err := listOwnerCredentialSecrets(ctx, client, namespace, owner)
	if err != nil {
		return nil, err
	}
	return filterByGrants(all, grantedSecretIDs, grantedConnectionIDs), nil
}

// filterByGrants narrows the owner's credential Secret list using the agent's
// granted IDs. Both lists are always selective: only Secrets whose identifier
// appears in the relevant grant slice are mounted into the sidecar.
//
//   - Regular secrets (`agent-platform.ai/secret-type` ∈ {anthropic, generic}):
//     keyed by the id suffix after `platform-cred-`, looked up in the granted
//     secret IDs.
//   - Connection secrets (`agent-platform.ai/secret-type` = connection):
//     keyed by `agent-platform.ai/connection`, looked up in the granted
//     connection IDs.
//
// An empty grant slice results in an empty intersection.
func filterByGrants(secrets []corev1.Secret, grantedSecretIDs, grantedConnectionIDs []string) []corev1.Secret {
	grantedSecretIds := toGrantSet(grantedSecretIDs)
	grantedConnIds := toGrantSet(grantedConnectionIDs)

	resolvedSecrets := map[string]bool{}
	resolvedConns := map[string]bool{}

	out := secrets[:0:0]
	for _, s := range secrets {
		switch s.Labels[envoySecretTypeLabel] {
		case "connection":
			connKey := s.Labels[envoyConnectionLabel]
			if grantedConnIds[connKey] {
				resolvedConns[connKey] = true
				out = append(out, s)
			}
		default:
			id := strings.TrimPrefix(s.Name, credentialSecretNamePrefix)
			if grantedSecretIds[id] {
				resolvedSecrets[id] = true
				out = append(out, s)
			}
		}
	}

	// A granted-id that doesn't resolve to an owner-owned Secret
	// silently contributes nothing (parse-tolerant fallback). Operators need
	// a signal so the missing-env mode is diagnosable; emit one log line per
	// reconcile naming the unresolved ids.
	if unresolved := unresolvedKeys(grantedSecretIds, resolvedSecrets); len(unresolved) > 0 {
		slog.Warn("granted-secret-ids contains ids with no matching owner Secret; entries contribute nothing",
			"unresolvedIds", unresolved)
	}
	if unresolved := unresolvedKeys(grantedConnIds, resolvedConns); len(unresolved) > 0 {
		slog.Warn("granted-connection-ids contains ids with no matching owner Secret; entries contribute nothing",
			"unresolvedIds", unresolved)
	}

	return out
}

func unresolvedKeys(granted, resolved map[string]bool) []string {
	var missing []string
	for id := range granted {
		if !resolved[id] {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)
	return missing
}

func toGrantSet(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		if p := strings.TrimSpace(id); p != "" {
			out[p] = true
		}
	}
	return out
}

// listOwnerCredentialSecrets returns the K8s Secrets the api-server has
// written for this owner.
func listOwnerCredentialSecrets(ctx context.Context, client kubernetes.Interface, namespace, owner string) ([]corev1.Secret, error) {
	if owner == "" {
		return nil, nil
	}
	selector := fmt.Sprintf("%s=%s,%s=api-server", envoyOwnerLabel, owner, envoyManagedByLabel)
	list, err := client.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("listing owner credential secrets: %w", err)
	}
	// Stable order so bootstrap regen is deterministic across reconciles.
	items := append([]corev1.Secret(nil), list.Items...)
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

type envMapping struct {
	EnvName     string `json:"envName"`
	Placeholder string `json:"placeholder"`
}

// credentialEnvVars synthesizes the env-var placeholders the agent harness
// needs so SDKs will dispatch (Envoy overwrites the real header on the
// wire). Source of truth: every Secret stamps `envoyEnvMappingsAnn` with
// the env it contributes (api-server connections from
// `flow.envMappings`; secrets module from `defaultEnvMappings`). The
// anthropic auth-mode switch remains as a fallback for Secrets created
// via raw `kubectl apply` without the annotation. Secrets are pre-sorted
// by Name in `listOwnerCredentialSecrets`, so dedup is "first-granted
// wins" on env-name collisions.
func credentialEnvVars(secrets []corev1.Secret) []corev1.EnvVar {
	const fallbackPlaceholder = "dummy-placeholder"
	seen := map[string]struct{}{}
	add := func(envs []corev1.EnvVar, name, value string) []corev1.EnvVar {
		if name == "" {
			return envs
		}
		if _, dup := seen[name]; dup {
			return envs
		}
		if value == "" {
			value = fallbackPlaceholder
		}
		seen[name] = struct{}{}
		return append(envs, corev1.EnvVar{Name: name, Value: value})
	}
	var envs []corev1.EnvVar
	for _, s := range secrets {
		if raw := s.Annotations[envoyEnvMappingsAnn]; raw != "" {
			var mappings []envMapping
			if err := json.Unmarshal([]byte(raw), &mappings); err != nil {
				slog.Warn("invalid env-mappings annotation; skipping",
					"namespace", s.Namespace, "secret", s.Name, "error", err)
			} else {
				for _, m := range mappings {
					envs = add(envs, m.EnvName, m.Placeholder)
				}
				continue
			}
		}
		// Anthropic fallback for hand-crafted Secrets without the
		// annotation. Every other Secret type relies on env-mappings.
		if s.Labels[envoySecretTypeLabel] == "anthropic" {
			if s.Annotations[envoyAuthModeAnn] == "api-key" {
				envs = add(envs, "ANTHROPIC_API_KEY", fallbackPlaceholder)
			} else {
				envs = add(envs, "CLAUDE_CODE_OAUTH_TOKEN", fallbackPlaceholder)
			}
		}
	}
	return envs
}

// connectionHostInjection mirrors the TS `ConnectionHostInjection`
// persisted on the `injection-hosts` annotation. Decoded once per Secret
// and fanned out by `chainsFromSecrets`.
type connectionHostInjection struct {
	Host           string `json:"host"`
	PathPattern    string `json:"pathPattern,omitempty"`
	HeaderName     string `json:"headerName,omitempty"`
	ValueFormat    string `json:"valueFormat,omitempty"`
	Encoding       string `json:"encoding,omitempty"`
	QueryParamName string `json:"queryParamName,omitempty"`
	HTTP2          bool   `json:"http2,omitempty"`
	// SDS filename chosen by the api-server, used verbatim. Empty on pre-`sdsKey` Secrets, where `sdsFileKey` falls back.
	SDSKey string `json:"sdsKey,omitempty"`
}

// sdsFileKeyForHost mirrors the api-server's `sdsFileKeyForHost` and is the fallback for pre-`sdsKey` Secrets. MUST stay byte-identical with the TS side — pinned by tests.
func sdsFileKeyForHost(host string) string {
	return "host-" + base64.RawURLEncoding.EncodeToString([]byte(host)) + ".sds.yaml"
}

// sdsFileKey returns the api-server's chosen key, else the legacy per-host key for pre-`sdsKey` Secrets.
func sdsFileKey(e connectionHostInjection) string {
	if e.SDSKey != "" {
		return e.SDSKey
	}
	return sdsFileKeyForHost(e.Host)
}

// expandConnectionSecret turns a connection Secret into one (host, cred)
// pair per entry in its `injection-hosts` JSON. Non-connection Secrets
// remain single-host (handled by the caller).
type hostCredential struct {
	host  string
	http2 bool
	cred  envoyCredential
}

func expandConnectionSecret(s corev1.Secret) []hostCredential {
	entries := parseConnectionHosts(s)
	if len(entries) == 0 {
		return nil
	}
	// Dedup by (host, header): a host may carry multiple injections, but a repeated (host, header) would make credential_injector clobber.
	seen := map[struct{ host, header string }]struct{}{}
	out := make([]hostCredential, 0, len(entries))
	for _, e := range entries {
		if e.Host == "" {
			continue
		}
		header := e.HeaderName
		if header == "" {
			header = "Authorization"
		}
		key := struct{ host, header string }{e.Host, header}
		if _, dup := seen[key]; dup {
			slog.Warn("duplicate (host, header) in injection-hosts; skipping later entry",
				"namespace", s.Namespace, "secret", s.Name, "host", e.Host, "headerName", header)
			continue
		}
		seen[key] = struct{}{}
		out = append(out, hostCredential{
			host:  e.Host,
			http2: e.HTTP2,
			cred: envoyCredential{
				SecretName:     s.Name,
				HeaderName:     header,
				QueryParamName: e.QueryParamName,
				VolumeName:     "cred-" + s.Name,
				SDSFileKey:     sdsFileKey(e),
			},
		})
	}
	return out
}

// parseConnectionHosts reads `injection-hosts` JSON. Connection Secrets
// without it are ignored — the api-server always writes the JSON.
func parseConnectionHosts(s corev1.Secret) []connectionHostInjection {
	raw := s.Annotations[envoyInjectionHostsAnn]
	if raw == "" {
		return nil
	}
	var entries []connectionHostInjection
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		slog.Warn("malformed injection-hosts annotation; skipping",
			"namespace", s.Namespace, "secret", s.Name, "error", err)
		return nil
	}
	return entries
}

// chainsFromSecrets groups (Secret, host) pairs into one filter chain
// per host. Connection Secrets fan into N pairs via `injection-hosts`
// JSON (issue #219); other types use the legacy `host-pattern`. Within a
// chain, duplicate header names are dropped (credential_injector
// overwrite: true would silently clobber) with a warning.
//
// Allow-only-only host → uncredentialed chain (MITM gate + dynamic_forward
// _proxy). Mixed → credentialed chain; allow-only contributes nothing.
func chainsFromSecrets(secrets []corev1.Secret) []envoyHostChain {
	type bucket struct {
		host        string
		seenHeader  map[string]string
		credentials []envoyCredential
		http2       bool
		first       string // first Secret name encountered for this host (drives ChainID)
	}
	byHost := map[string]*bucket{}
	order := []string{}

	add := func(host, secretName string, cred *envoyCredential, http2 bool) {
		if host == "" {
			return
		}
		b := byHost[host]
		if b == nil {
			b = &bucket{host: host, seenHeader: map[string]string{}, first: secretName}
			byHost[host] = b
			order = append(order, host)
		}
		if http2 {
			b.http2 = true
		}
		if cred == nil {
			return
		}
		header := cred.HeaderName
		if header == "" {
			header = "Authorization"
		}
		if winner, dup := b.seenHeader[header]; dup {
			slog.Warn("duplicate injection header on host; later credential skipped to avoid credential_injector clobber",
				"host", host, "headerName", header,
				"winningSecret", winner, "skippedSecret", secretName)
			return
		}
		b.seenHeader[header] = secretName
		c := *cred
		c.HeaderName = header
		b.credentials = append(b.credentials, c)
	}

	for _, s := range secrets {
		switch s.Labels[envoySecretTypeLabel] {
		case "connection":
			for _, hc := range expandConnectionSecret(s) {
				cred := hc.cred
				// A bootstrap referencing an SDS file absent from the mounted
				// Secret is a fatal Envoy boot error (crash-loops the whole
				// gateway). Stale Secrets with mismatched data keys exist
				// (pre-cutover writers used a different key naming), so
				// degrade the host to allow-only instead of rendering an
				// unbootable config.
				if len(s.Data[cred.SDSFileKey]) == 0 {
					slog.Warn("connection Secret missing SDS data key; rendering host allow-only (no credential injection)",
						"namespace", s.Namespace, "secret", s.Name, "host", hc.host, "sdsKey", cred.SDSFileKey)
					add(hc.host, s.Name, nil, hc.http2)
					continue
				}
				add(hc.host, s.Name, &cred, hc.http2)
			}
			continue
		}
		// Non-connection Secret: single host via the legacy host-pattern
		// annotation. Allow-only Secrets register the host (extends the
		// leaf cert SAN list, forces L7 termination) but contribute no
		// credential.
		host := s.Annotations[envoyHostPatternAnn]
		if host == "" {
			continue
		}
		http2 := s.Annotations[envoyInjectionHTTP2Ann] == "true"
		if s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
			add(host, s.Name, nil, http2)
			continue
		}
		if len(s.Data[envoyCredentialKeySDS]) == 0 {
			slog.Warn("credential Secret missing sds.yaml data key; rendering host allow-only (no credential injection)",
				"namespace", s.Namespace, "secret", s.Name, "host", host)
			add(host, s.Name, nil, http2)
			continue
		}
		cred := envoyCredential{
			SecretName:     s.Name,
			HeaderName:     s.Annotations[envoyHeaderNameAnn],
			QueryParamName: s.Annotations[envoyQueryParamAnn],
			VolumeName:     "cred-" + s.Name,
			SDSFileKey:     envoyCredentialKeySDS,
		}
		add(host, s.Name, &cred, http2)
	}

	chains := make([]envoyHostChain, 0, len(order))
	for _, host := range order {
		b := byHost[host]
		// Suffix the host fingerprint so one Secret driving multiple
		// hosts (github → 3 chains, #219) doesn't collide on
		// `chain_<secret>` / `upstream_<secret>`.
		chains = append(chains, envoyHostChain{
			ChainID:         "chain_" + b.first + "_" + hostShort(host),
			UpstreamCluster: "upstream_" + b.first + "_" + hostShort(host),
			Host:            host,
			Credentials:     b.credentials,
			HTTP2:           b.http2,
		})
	}
	return chains
}

// hostShort returns an 8-hex-char fingerprint of a hostname — same prefix
// shape as `sdsFileKeyForHost` so ChainID / UpstreamCluster stay readable
// and stable across reconciles.
func hostShort(host string) string {
	h := sha1.Sum([]byte(host)) // #nosec G401 — non-cryptographic
	return hex.EncodeToString(h[:])[:8]
}

// hostInChains reports whether any per-host chain already terminates `host`.
// Used to suppress the telemetry collector chain when the collector host
// would collide with a credentialed/allow-only chain (duplicate
// `server_names` is a fatal Envoy config error).
func hostInChains(chains []envoyHostChain, host string) bool {
	if host == "" {
		return false
	}
	for _, c := range chains {
		if c.Host == host {
			return true
		}
	}
	return false
}

// Bootstrap template — TLS-intercepting CONNECT proxy.
//
// Topology:
//   1. The agent points HTTP(S)_PROXY at the paired gateway pod's Service DNS
//      (e.g. `<instance>-gateway:<port>`). The listener binds 0.0.0.0 inside
//      the gateway pod; reach is gated by NetworkPolicy, not bind address.
//   2. The OUTER listener on that port is an HCM that terminates the agent's
//      CONNECT and routes the inner stream into the INTERNAL listener (Envoy's
//      "internal listener" feature, addressed via envoy_internal_address).
//   3. The INTERNAL listener uses tls_inspector to read SNI. One filter chain
//      per known host terminates TLS with that host's leaf cert; default
//      filter chain (SNI miss) does TCP passthrough via sni_dynamic_forward_proxy.
//   4. Inside a TLS-terminating chain, an HCM runs credential_injector and
//      forwards to a per-credential STRICT_DNS cluster pinned to the
//      credential's host. The agent's inner Host header has no influence on
//      routing — Envoy's destination is fixed in config — so the
//      route-confusion exfiltration path in the threat model
//      is structurally closed. Allow-only chains (path-rule promoted, no
//      credential) keep using dynamic_forward_proxy_https; they have no
//      credential to misroute.
//
// Notes:
//   - credential_injector lives at the HCM level (not per-route) because each
//      filter chain's HCM is already host-specific. No composite filter needed.
//   - Each credentialed cluster sets explicit upstream SNI and SAN-pinned
//      validation against the credential's host, so a poisoned-DNS or
//      misconfigured cluster fails the upstream TLS handshake before any
//      credentialed body reaches the wire.
//   - Upstream TLS validation uses Envoy's default system trust bundle; the
//      gateway image must ship one (envoy-distroless does).
//   - Admin interface intentionally omitted; the gateway pod's NetworkPolicy
//      additionally admits ingress only from its paired agent pod.

// Gateway liveness path the health_check filter answers locally before
// ext_authz, so the np-gate probe doesn't trip the egress gate (#675).
const platformGatewayHealthPath = "/__platform_healthz"

const envoyBootstrapTmpl = `node:
  id: platform-credential-injector
  cluster: platform-credential-injector
bootstrap_extensions:
  - name: envoy.bootstrap.internal_listener
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.bootstrap.internal_listener.v3.InternalListener
{{- if $.OTel.Metrics }}
# Push Envoy's stats (ext_authz outcomes, TLS handshakes, cluster health, DNS)
# over OTLP/gRPC to the collector. No admin interface is enabled, so this is the
# only stats egress; the sink does not require one.
stats_sinks:
  - name: envoy.stat_sinks.open_telemetry
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.stat_sinks.open_telemetry.v3.SinkConfig
      grpc_service:
        envoy_grpc:
          cluster_name: otel_export
        timeout: 5s
{{- end }}
static_resources:
  listeners:
    - name: agent_egress
      address:
        socket_address: { address: {{ .ListenAddress }}, port_value: {{ .Port }} }
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: agent_egress
{{- if $.OTel.Traces }}
                # OpenTelemetry tracing for egress. Scoped to this outer listener
                # so spans see CONNECT (method + host:port, never a path/query) and
                # plain-HTTP egress — credential injection happens downstream on the
                # TLS-terminating chains, so no injected secret can reach a span tag
                # here. traceparent is stripped on the external-egress route below.
                tracing:
                  spawn_upstream_span: false
                  max_path_tag_length: 256
                  # Sampling from the relayed OTEL_TRACES_SAMPLER[/_ARG]; Envoy's
                  # tracer ignores those env vars, so the controller translates them.
                  random_sampling:
                    value: {{ $.OTel.SamplingPercent }}
                  provider:
                    name: envoy.tracers.opentelemetry
                    typed_config:
                      "@type": type.googleapis.com/envoy.config.trace.v3.OpenTelemetryConfig
                      service_name: "{{ $.OTel.ServiceName }}"
{{- if $.OTel.GRPC }}
                      grpc_service:
                        envoy_grpc:
                          cluster_name: otel_export
                        timeout: 5s
{{- else }}
                      http_service:
                        http_uri:
                          uri: "{{ $.OTel.TracesURI }}"
                          cluster: otel_export
                          timeout: 5s
{{- end }}
                      # platform.gateway.id (a bounded per-gateway label) rides in
                      # via OTEL_RESOURCE_ATTRIBUTES on the container; service.name
                      # stays shared so trace cardinality doesn't scale with agent count.
                      resource_detectors:
                        - name: envoy.tracers.opentelemetry.resource_detectors.environment
                          typed_config:
                            "@type": type.googleapis.com/envoy.extensions.tracers.opentelemetry.resource_detectors.v3.EnvironmentResourceDetectorConfig
{{- end }}
{{- if $.OTel.AccessLogs }}
                access_log:
                  - name: envoy.access_loggers.file
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
                      path: /dev/stdout
                      log_format:
                        formatters:
                          - name: envoy.formatter.req_without_query
                            typed_config:
                              "@type": type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery
                        json_format:
                          # Credential bytes never reach this log: the Authorization
                          # header is simply not referenced, and REQ_WITHOUT_QUERY
                          # strips the query string (where the Lua filter parks
                          # query-param credentials) from the logged path.
                          service_name: "{{ $.OTel.ServiceName }}"
                          agent_id: "{{ $.OTel.AgentID }}"
                          start_time: "%START_TIME%"
                          method: "%REQ(:METHOD)%"
                          authority: "%REQ(:AUTHORITY)%"
                          path: "%REQ_WITHOUT_QUERY(:PATH)%"
                          response_code: "%RESPONSE_CODE%"
                          response_flags: "%RESPONSE_FLAGS%"
                          duration_ms: "%DURATION%"
                          upstream_host: "%UPSTREAM_HOST%"
                          bytes_received: "%BYTES_RECEIVED%"
                          bytes_sent: "%BYTES_SENT%"
                          x_request_id: "%REQ(X-REQUEST-ID)%"
                  # Same records to the collector over OTLP so gateway access
                  # logs land in the telemetry backend beside every other
                  # platform service's logs; stdout above stays the pod log.
                  - name: envoy.access_loggers.open_telemetry
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig
{{- if $.OTel.GRPC }}
                      grpc_service:
                        envoy_grpc:
                          cluster_name: otel_export
                        timeout: 5s
{{- else }}
                      http_service:
                        http_uri:
                          uri: "{{ $.OTel.LogsURI }}"
                          cluster: otel_export
                          timeout: 5s
{{- end }}
                      stat_prefix: egress
                      disable_builtin_labels: true
                      formatters:
                        - name: envoy.formatter.req_without_query
                          typed_config:
                            "@type": type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery
                      resource_attributes:
                        values:
                          - key: service.name
                            value: { string_value: "{{ $.OTel.ServiceName }}" }
                          - key: platform.gateway.id
                            value: { string_value: "{{ $.OTel.AgentID }}" }
                      body:
                        string_value: "%REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %RESPONSE_CODE%"
                      attributes:
                        values:
                          - key: chain
                            value: { string_value: agent_egress }
                          - key: method
                            value: { string_value: "%REQ(:METHOD)%" }
                          - key: authority
                            value: { string_value: "%REQ(:AUTHORITY)%" }
                          - key: path
                            value: { string_value: "%REQ_WITHOUT_QUERY(:PATH)%" }
                          - key: response_code
                            value: { string_value: "%RESPONSE_CODE%" }
                          - key: response_flags
                            value: { string_value: "%RESPONSE_FLAGS%" }
                          - key: duration_ms
                            value: { string_value: "%DURATION%" }
                          - key: upstream_host
                            value: { string_value: "%UPSTREAM_HOST%" }
                          - key: bytes_received
                            value: { string_value: "%BYTES_RECEIVED%" }
                          - key: bytes_sent
                            value: { string_value: "%BYTES_SENT%" }
                          - key: x_request_id
                            value: { string_value: "%REQ(X-REQUEST-ID)%" }
{{- end }}
                upgrade_configs:
                  - upgrade_type: CONNECT
                  # dam-run opens a WebSocket to the harness /run endpoint. The
                  # CONNECT-tunnelled path carries it transparently; this also
                  # admits the Upgrade on the absolute-URI forward path.
                  - upgrade_type: websocket
                http_filters:
                  # np-gate liveness probe (#675): answered locally before
                  # ext_authz; pass_through_mode:false so it never forwards.
                  - name: envoy.filters.http.health_check
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.health_check.v3.HealthCheck
                      pass_through_mode: false
                      headers:
                        - name: ":path"
                          string_match: { exact: "{{ $.HealthPath }}" }
                  # Gate plain-HTTP egress. The
                  # CONNECT route disables this via per-route config — TLS
                  # tunnels are gated downstream (per-host L7 chain or
                  # SNI-miss L4 catch-all). Without this filter, plain
                  # HTTP requests would 404 with no inbox prompt.
                  - name: envoy.filters.http.ext_authz
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
                      transport_api_version: V3
                      failure_mode_allow: false
                      grpc_service:
                        envoy_grpc:
                          cluster_name: ext_authz_cluster
                          # Pin :authority to the per-instance
                          # ext-authz Service hostname. Without this,
                          # Envoy's default :authority is the cluster
                          # name and the api-server cannot derive
                          # instance ID from it.
                          authority: "{{ $.ExtAuthzHost }}"
                        # Instance identity is conveyed by the
                        # gRPC :authority of the per-instance ext-authz
                        # Service this cluster dials, cryptographically
                        # pinned by the AuthorizationPolicy on that
                        # Service. No x-platform-instance metadata.
                        timeout: {{ $.ExtAuthzTimeoutSeconds }}s
                  - name: envoy.filters.http.dynamic_forward_proxy
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.dynamic_forward_proxy.v3.FilterConfig
                      dns_cache_config:
                        name: dns_cache
                        dns_lookup_family: V4_PREFERRED
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
                route_config:
                  name: connect_routes
                  virtual_hosts:
                    - name: connect
                      domains: [ "*" ]
                      routes:
                        # Harness CONNECT: Node's fetch (NODE_USE_ENV_PROXY=1
                        # → EnvHttpProxyAgent) tunnels plain HTTP via CONNECT
                        # rather than absolute-URI proxying. The generic
                        # connect_matcher below routes into the TLS-intercept
                        # chain — wrong for a plain-HTTP target, so it RSTs.
                        # Match harness CONNECTs by :authority and splice raw
                        # TCP to a pinned upstream. ztunnel still encapsulates
                        # the gateway's outbound with the per-instance SPIFFE
                        # principal, so the waypoint policy fires the same as
                        # on the absolute-URI route below.
                        - match:
                            connect_matcher: {}
                            headers:
                              - name: ":authority"
                                string_match:
                                  exact: "{{ $.HarnessAuthority }}"
                          route:
                            cluster: harness_passthrough
                            upgrade_configs:
                              - upgrade_type: CONNECT
                                connect_config: {}
                          typed_per_filter_config:
                            envoy.filters.http.ext_authz:
                              "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthzPerRoute
                              disabled: true
{{- if and .Telemetry $.OTel.Traces }}
                        # Agent-telemetry export CONNECT (collector authority).
                        # Same tunnel as the generic CONNECT below — the transit
                        # chain downstream MITMs and attributes it — but with
                        # tracing sampled to zero: these are platform-internal
                        # telemetry pushes on a per-export-interval cadence, and
                        # tracing them makes the pipeline observe itself. The
                        # access log still records the tunnel.
                        - match:
                            connect_matcher: {}
                            headers:
                              - name: ":authority"
                                string_match:
                                  exact: "{{ .TelemetryCollectorHost }}:{{ .TelemetryCollectorPort }}"
                          route:
                            cluster: tls_inspect_internal
                            upgrade_configs:
                              - upgrade_type: CONNECT
                                connect_config: {}
                          tracing:
                            random_sampling:
                              numerator: 0
                            overall_sampling:
                              numerator: 0
                          typed_per_filter_config:
                            envoy.filters.http.ext_authz:
                              "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthzPerRoute
                              disabled: true
{{- end }}
                        - match: { connect_matcher: {} }
                          route:
                            cluster: tls_inspect_internal
                            upgrade_configs:
                              - upgrade_type: CONNECT
                                connect_config: {}
                          typed_per_filter_config:
                            envoy.filters.http.ext_authz:
                              "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthzPerRoute
                              disabled: true
                        # Platform-internal harness traffic. Match by
                        # :authority so this route only applies to
                        # api-server-bound calls; everything else falls
                        # through to the egress fallthrough below.
                        # Identity is conveyed by the SPIFFE
                        # peer principal that ztunnel applies when
                        # encapsulating outbound traffic — the gateway
                        # pod runs as the per-instance SA, and the
                        # waypoint enforces principal == URL :id. No
                        # header injection needed. ext_authz is disabled
                        # on this route: harness traffic is control-plane
                        # to the api-server, not user egress, so HITL
                        # rules do not apply.
                        - match:
                            prefix: "/"
                            headers:
                              - name: ":authority"
                                string_match:
                                  exact: "{{ $.HarnessAuthority }}"
                          route:
                            cluster: dynamic_forward_proxy_http
                            timeout: 0s
                          typed_per_filter_config:
                            envoy.filters.http.ext_authz:
                              "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthzPerRoute
                              disabled: true
                        # Plain HTTP fallthrough. The outer HCM's
                        # ext_authz fires here (CONNECT disables it
                        # per-route above; plain HTTP does not), passing
                        # method/path/host to the same gate the inner
                        # TLS-terminating chains use post-MITM — path
                        # and method rules apply identically. Forward
                        # via dynamic_forward_proxy_http to the
                        # upstream's HTTP port; no MITM needed since
                        # the bytes are already plaintext.
                        - match: { prefix: "/" }
{{- if $.OTel.Traces }}
                          # Strip internal trace context before it reaches an
                          # external HTTP upstream. The egress span is still
                          # exported to the collector; the harness route above
                          # deliberately keeps these headers so its spans link to
                          # the api-server.
                          request_headers_to_remove: [ traceparent, tracestate ]
{{- end }}
                          route:
                            cluster: dynamic_forward_proxy_http
                            timeout: 0s

    - name: tls_inspect_internal
      internal_listener: {}
      listener_filters:
        - name: envoy.filters.listener.tls_inspector
          typed_config:
            "@type": type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector
      filter_chains:
{{- range $chain := .Chains }}
        - name: terminate_{{ $chain.ChainID }}
          filter_chain_match:
            server_names: [ "{{ $chain.Host }}" ]
          transport_socket:
            name: envoy.transport_sockets.tls
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
              common_tls_context:
{{- if $chain.HTTP2 }}
                # gRPC chain: offer h2 so the agent's grpclib client negotiates
                # HTTP/2 over the MITM cert. REST chains omit ALPN and stay h1.
                alpn_protocols: [ "h2", "http/1.1" ]
{{- end }}
                tls_certificates:
                  - certificate_chain: { filename: {{ $.LeafTLSDir }}/tls.crt }
                    private_key:      { filename: {{ $.LeafTLSDir }}/tls.key }
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: terminate_{{ $chain.ChainID }}
{{- if and $.OTel.Traces (not $chain.HasQueryParamCredential) }}
                # Traced: this chain sees the agent's decrypted traceparent, so
                # its span joins the harness trace and ext_authz carries that
                # context to the api-server — the one place harness, gateway,
                # and egress-approval spans can meet in a single trace. Safe
                # only because every credential here is header-injected and
                # span tags never record headers; chains with a query-param
                # credential stay untraced (post-injection :path carries the
                # credential; Envoy has no query-stripper for span tags).
                # max_path_tag_length 1 keeps the agent-authored path/query —
                # which may hold agent-side secrets such as presigned URLs —
                # out of the http.url tag; per-request detail stays in the
                # query-stripped access log, joinable via the x-request-id tag.
                tracing:
                  spawn_upstream_span: false
                  max_path_tag_length: 1
                  random_sampling:
                    value: {{ $.OTel.SamplingPercent }}
                  provider:
                    name: envoy.tracers.opentelemetry
                    typed_config:
                      "@type": type.googleapis.com/envoy.config.trace.v3.OpenTelemetryConfig
                      service_name: "{{ $.OTel.ServiceName }}"
{{- if $.OTel.GRPC }}
                      grpc_service:
                        envoy_grpc:
                          cluster_name: otel_export
                        timeout: 5s
{{- else }}
                      http_service:
                        http_uri:
                          uri: "{{ $.OTel.TracesURI }}"
                          cluster: otel_export
                          timeout: 5s
{{- end }}
                      resource_detectors:
                        - name: envoy.tracers.opentelemetry.resource_detectors.environment
                          typed_config:
                            "@type": type.googleapis.com/envoy.extensions.tracers.opentelemetry.resource_detectors.v3.EnvironmentResourceDetectorConfig
{{- end }}
{{- if $.OTel.AccessLogs }}
                # Access logs are credential-safe on every chain — they use
                # REQ_WITHOUT_QUERY and never name the Authorization header —
                # and the api-server ext_authz decision log already records the
                # egress verdict for every credentialed request.
                access_log:
                  - name: envoy.access_loggers.file
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
                      path: /dev/stdout
                      log_format:
                        formatters:
                          - name: envoy.formatter.req_without_query
                            typed_config:
                              "@type": type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery
                        json_format:
                          service_name: "{{ $.OTel.ServiceName }}"
                          agent_id: "{{ $.OTel.AgentID }}"
                          chain: terminate_{{ $chain.ChainID }}
                          start_time: "%START_TIME%"
                          method: "%REQ(:METHOD)%"
                          authority: "%REQ(:AUTHORITY)%"
                          path: "%REQ_WITHOUT_QUERY(:PATH)%"
                          response_code: "%RESPONSE_CODE%"
                          response_flags: "%RESPONSE_FLAGS%"
                          duration_ms: "%DURATION%"
                          upstream_host: "%UPSTREAM_HOST%"
                          bytes_received: "%BYTES_RECEIVED%"
                          bytes_sent: "%BYTES_SENT%"
                          x_request_id: "%REQ(X-REQUEST-ID)%"
                  # The L7 detail for intercepted flows lives only on these
                  # chains (the outer listener sees just the CONNECT), so this
                  # OTLP copy is what makes credentialed egress explorable in
                  # the telemetry backend. Same redaction as the file log.
                  - name: envoy.access_loggers.open_telemetry
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig
{{- if $.OTel.GRPC }}
                      grpc_service:
                        envoy_grpc:
                          cluster_name: otel_export
                        timeout: 5s
{{- else }}
                      http_service:
                        http_uri:
                          uri: "{{ $.OTel.LogsURI }}"
                          cluster: otel_export
                          timeout: 5s
{{- end }}
                      stat_prefix: chains
                      disable_builtin_labels: true
                      formatters:
                        - name: envoy.formatter.req_without_query
                          typed_config:
                            "@type": type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery
                      resource_attributes:
                        values:
                          - key: service.name
                            value: { string_value: "{{ $.OTel.ServiceName }}" }
                          - key: platform.gateway.id
                            value: { string_value: "{{ $.OTel.AgentID }}" }
                      body:
                        string_value: "%REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %RESPONSE_CODE%"
                      attributes:
                        values:
                          - key: chain
                            value: { string_value: terminate_{{ $chain.ChainID }} }
                          - key: method
                            value: { string_value: "%REQ(:METHOD)%" }
                          - key: authority
                            value: { string_value: "%REQ(:AUTHORITY)%" }
                          - key: path
                            value: { string_value: "%REQ_WITHOUT_QUERY(:PATH)%" }
                          - key: response_code
                            value: { string_value: "%RESPONSE_CODE%" }
                          - key: response_flags
                            value: { string_value: "%RESPONSE_FLAGS%" }
                          - key: duration_ms
                            value: { string_value: "%DURATION%" }
                          - key: upstream_host
                            value: { string_value: "%UPSTREAM_HOST%" }
                          - key: bytes_received
                            value: { string_value: "%BYTES_RECEIVED%" }
                          - key: bytes_sent
                            value: { string_value: "%BYTES_SENT%" }
                          - key: x_request_id
                            value: { string_value: "%REQ(X-REQUEST-ID)%" }
{{- end }}
                http_filters:
                  # HITL gate. gRPC ext_authz to the
                  # api-server's single auth endpoint — same Check RPC used
                  # by the L4 catch-all chain below. Rules match short-circuit
                  # ALLOW/DENY; misses persist a pending row and hold the
                  # call up to {{ $.ExtAuthzHoldSeconds }}s. failure_mode_allow
                  # is false so a Redis/api-server outage fails closed.
                  - name: envoy.filters.http.ext_authz
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
                      transport_api_version: V3
                      failure_mode_allow: false
                      grpc_service:
                        envoy_grpc:
                          cluster_name: ext_authz_cluster
                          # Pin :authority to the per-instance
                          # ext-authz Service hostname. Without this,
                          # Envoy's default :authority is the cluster
                          # name and the api-server cannot derive
                          # instance ID from it.
                          authority: "{{ $.ExtAuthzHost }}"
                        # Instance identity is conveyed by the
                        # gRPC :authority of the per-instance ext-authz
                        # Service this cluster dials.
                        timeout: {{ $.ExtAuthzTimeoutSeconds }}s
{{- range $cred := $chain.Credentials }}
                  # Credential {{ $cred.SecretName }} → header {{ $cred.HeaderName }}{{ if $cred.QueryParamName }} → URL ?{{ $cred.QueryParamName }}{{ end }}
                  - name: envoy.filters.http.credential_injector
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector
                      overwrite: true
                      credential:
                        name: envoy.http.injected_credentials.generic
                        typed_config:
                          "@type": type.googleapis.com/envoy.extensions.http.injected_credentials.generic.v3.Generic
                          credential:
                            name: {{ $.CredentialSDSName }}
                            sds_config:
                              path_config_source:
                                path: {{ $.CredentialsRoot }}/{{ $cred.VolumeName }}/{{ $cred.SDSFileKey }}
                                # Watch the Secret-volume mount root, not the
                                # sds.yaml path. Kubelet rotates the ..data
                                # symlink inside the mount when a Secret
                                # changes; the leaf symlink at the mount root
                                # never gets renamed, so Envoy's default
                                # path-only inotify never fires and a refreshed
                                # access token never reaches the in-memory SDS
                                # resource. See envoy PathConfigSource docs.
                                watched_directory:
                                  path: {{ $.CredentialsRoot }}/{{ $cred.VolumeName }}
                          header: "{{ $cred.HeaderName }}"
{{- if $cred.QueryParamName }}
                  # Query-param injection. credential_injector wrote the
                  # SDS value into header {{ $cred.HeaderName }}; this
                  # filter moves it into URL query parameter
                  # {{ $cred.QueryParamName }} and strips the header so
                  # it never reaches the upstream. The SDS file is
                  # stored as the bare value (api-server sdsInlineString)
                  # so the URL doesn't grow a Bearer prefix. Path is
                  # parsed manually (no Lua-pattern gsub) so credential
                  # bytes can't be interpreted as Lua replacement
                  # backreferences.
                  - name: envoy.filters.http.lua
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                      default_source_code:
                        inline_string: |
                          local HEADER = {{ printf "%q" $cred.HeaderName }}
                          local PARAM  = {{ printf "%q" $cred.QueryParamName }}
                          -- Percent-encode every byte outside RFC 3986
                          -- unreserved. Without this, a credential
                          -- containing & or = would break out of its
                          -- query parameter — the splitter below frames
                          -- on those bytes literally. We encode the
                          -- credential value but not PARAM (PARAM is
                          -- api-server-validated against the URL-safe
                          -- charset, so it's already safe).
                          local function urlencode(s)
                            return (string.gsub(s, "[^A-Za-z0-9%-_.~]", function(c)
                              return string.format("%%%02X", string.byte(c))
                            end))
                          end
                          function envoy_on_request(rh)
                            local h = rh:headers()
                            local cred = h:get(HEADER)
                            if cred == nil or cred == "" then return end
                            h:remove(HEADER)
                            cred = urlencode(cred)
                            local path = h:get(":path")
                            if path == nil then return end
                            local qi = string.find(path, "?", 1, true)
                            local prefix, query
                            if qi then
                              prefix = string.sub(path, 1, qi)
                              query  = string.sub(path, qi + 1)
                            else
                              prefix = path .. "?"
                              query  = ""
                            end
                            local out = {}
                            local replaced = false
                            for pair in string.gmatch(query, "[^&]+") do
                              local eq = string.find(pair, "=", 1, true)
                              local key = eq and string.sub(pair, 1, eq - 1) or pair
                              if key == PARAM then
                                out[#out + 1] = PARAM .. "=" .. cred
                                replaced = true
                              else
                                out[#out + 1] = pair
                              end
                            end
                            if not replaced then
                              out[#out + 1] = PARAM .. "=" .. cred
                            end
                            h:replace(":path", prefix .. table.concat(out, "&"))
                          end
{{- end }}
{{- end }}
                  - name: envoy.filters.http.dynamic_forward_proxy
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.dynamic_forward_proxy.v3.FilterConfig
                      dns_cache_config:
                        name: dns_cache
                        dns_lookup_family: V4_PREFERRED
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
                route_config:
                  name: forward_{{ $chain.ChainID }}
                  virtual_hosts:
                    - name: default
                      domains: [ "*" ]
                      routes:
                        - match: { prefix: "/" }
                          route:
{{- if $chain.Credentialed }}
                            # Pinned to a per-chain static cluster (clusters
                            # list below). The agent's Host header cannot
                            # steer this request to a different upstream;
                            # the cluster's destination is fixed in config.
                            # host_rewrite_literal additionally canonicalises
                            # the upstream Host so honest backends never see
                            # an agent-manipulated value.
                            cluster: {{ $chain.UpstreamCluster }}
                            host_rewrite_literal: "{{ $chain.Host }}"
{{- else }}
                            # Allow-only (path-rule promoted, no credential
                            # injection). Forward via dynamic_forward_proxy;
                            # no credential to misroute.
                            cluster: dynamic_forward_proxy_https
{{- end }}
                            timeout: 0s
{{- end }}
{{- if .Telemetry }}
        # Telemetry egress. The agent exports OTLP/HTTP to the collector
        # through this gateway (its only admitted egress route); we MITM-
        # terminate here on the collector SNI and stamp the trusted
        # x-platform-agent-id header, OVERWRITING anything the agent set, so the
        # collector attributes the telemetry to this instance and no agent can
        # forge another's identity. No ext_authz (platform-internal traffic,
        # not user egress) and no credential injection. Forwards plaintext to
        # the in-cluster collector; ztunnel wraps the gateway→collector hop in
        # mTLS. The collector host is in the leaf SAN (see leaf.go), so the
        # agent's TLS client validates this intercept cert.
        - name: terminate_otel_collector
          filter_chain_match:
            server_names: [ "{{ .TelemetryCollectorHost }}" ]
          transport_socket:
            name: envoy.transport_sockets.tls
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
              common_tls_context:
                tls_certificates:
                  - certificate_chain: { filename: {{ .LeafTLSDir }}/tls.crt }
                    private_key:      { filename: {{ .LeafTLSDir }}/tls.key }
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: terminate_otel_collector
{{- if $.OTel.AccessLogs }}
                # Error-only: agent-telemetry delivery failures are otherwise
                # invisible (this chain has no tracing by design, and the OTel
                # stats sink is off on OTLP/HTTP exporters). Steady-state
                # success volume stays zero.
                access_log:
                  - name: envoy.access_loggers.file
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
                      path: /dev/stdout
                      log_format:
                        formatters:
                          - name: envoy.formatter.req_without_query
                            typed_config:
                              "@type": type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery
                        json_format:
                          service_name: "{{ $.OTel.ServiceName }}"
                          agent_id: "{{ $.OTel.AgentID }}"
                          chain: terminate_otel_collector
                          start_time: "%START_TIME%"
                          method: "%REQ(:METHOD)%"
                          path: "%REQ_WITHOUT_QUERY(:PATH)%"
                          response_code: "%RESPONSE_CODE%"
                          response_flags: "%RESPONSE_FLAGS%"
                          duration_ms: "%DURATION%"
                          upstream_host: "%UPSTREAM_HOST%"
                    filter:
                      or_filter:
                        filters:
                          - status_code_filter:
                              comparison:
                                op: GE
                                value:
                                  default_value: 400
                                  runtime_key: access_log.otel_collector.min_status
                          - response_flag_filter: {}
                  # OTLP twin for partial failures (collector up but rejecting,
                  # e.g. 4xx schema errors). The stdout copy above is the
                  # outage-proof record — when the collector is down this
                  # export fails with it.
                  - name: envoy.access_loggers.open_telemetry
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig
{{- if $.OTel.GRPC }}
                      grpc_service:
                        envoy_grpc:
                          cluster_name: otel_export
                        timeout: 5s
{{- else }}
                      http_service:
                        http_uri:
                          uri: "{{ $.OTel.LogsURI }}"
                          cluster: otel_export
                          timeout: 5s
{{- end }}
                      stat_prefix: otel_transit
                      disable_builtin_labels: true
                      formatters:
                        - name: envoy.formatter.req_without_query
                          typed_config:
                            "@type": type.googleapis.com/envoy.extensions.formatter.req_without_query.v3.ReqWithoutQuery
                      resource_attributes:
                        values:
                          - key: service.name
                            value: { string_value: "{{ $.OTel.ServiceName }}" }
                          - key: platform.gateway.id
                            value: { string_value: "{{ $.OTel.AgentID }}" }
                      body:
                        string_value: "telemetry delivery failure %REQ(:METHOD)% %REQ_WITHOUT_QUERY(:PATH)% %RESPONSE_CODE% %RESPONSE_FLAGS%"
                      attributes:
                        values:
                          - key: chain
                            value: { string_value: terminate_otel_collector }
                          - key: method
                            value: { string_value: "%REQ(:METHOD)%" }
                          - key: path
                            value: { string_value: "%REQ_WITHOUT_QUERY(:PATH)%" }
                          - key: response_code
                            value: { string_value: "%RESPONSE_CODE%" }
                          - key: response_flags
                            value: { string_value: "%RESPONSE_FLAGS%" }
                          - key: duration_ms
                            value: { string_value: "%DURATION%" }
                          - key: upstream_host
                            value: { string_value: "%UPSTREAM_HOST%" }
                    filter:
                      or_filter:
                        filters:
                          - status_code_filter:
                              comparison:
                                op: GE
                                value:
                                  default_value: 400
                                  runtime_key: access_log.otel_collector.min_status
                          - response_flag_filter: {}
{{- end }}
                http_filters:
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
                route_config:
                  name: forward_otel_collector
                  virtual_hosts:
                    - name: default
                      domains: [ "*" ]
                      routes:
                        - match: { prefix: "/" }
                          route:
                            # Pinned to the static plaintext collector cluster
                            # (clusters list below); the agent's Host header
                            # cannot steer the destination.
                            cluster: otel_collector
                            host_rewrite_literal: "{{ .TelemetryCollectorHost }}"
                            timeout: 0s
                          request_headers_to_add:
                            # Trusted, unforgeable identity: OVERWRITE replaces
                            # any x-platform-agent-id the agent supplied. The
                            # value is fixed in this gateway's controller-
                            # rendered config; the agent cannot change it.
                            - header:
                                key: x-platform-agent-id
                                value: "{{ .InstanceID }}"
                              append_action: OVERWRITE_IF_EXISTS_OR_ADD
{{- end }}
        # SNI miss: every other host hits the L4 ext_authz catch-all, which
        # gates by SNI alone via the API server's gRPC ext_authz endpoint.
        # No TLS termination, no credential injection -- bytes pass through
        # to the real upstream once the gate replies OK. There is no static
        # passthrough escape hatch in v1; default-deny is the API server's
        # egress_rules evaluation.
        - name: l4_authz_passthrough
          filters:
            - name: envoy.filters.network.ext_authz
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.ext_authz.v3.ExtAuthz
                stat_prefix: l4_authz
                transport_api_version: V3
                failure_mode_allow: false
                # Envoy only populates AttributeContext.tls_session.sni when
                # this is set; without it the api-server gate sees host=null
                # and denies every L4 request with "missing host/sni".
                include_tls_session: true
                grpc_service:
                  envoy_grpc:
                    cluster_name: ext_authz_cluster
                    # Pin :authority to the per-instance
                    # ext-authz Service hostname (see HCM ext_authz
                    # block above for rationale).
                    authority: "{{ $.ExtAuthzHost }}"
                  timeout: {{ $.ExtAuthzTimeoutSeconds }}s
            - name: envoy.filters.network.sni_dynamic_forward_proxy
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.sni_dynamic_forward_proxy.v3.FilterConfig
                port_value: 443
                dns_cache_config:
                  name: dns_cache
                  dns_lookup_family: V4_PREFERRED
            - name: envoy.filters.network.tcp_proxy
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy
                stat_prefix: l4_authz_forward
                cluster: dynamic_forward_proxy_tcp
{{- if $.OTel.AccessLogs }}
                # SNI-passthrough egress visibility: requested server name + byte
                # counts only. L4, so there is no path/query and nothing to redact.
                access_log:
                  - name: envoy.access_loggers.file
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.file.v3.FileAccessLog
                      path: /dev/stdout
                      log_format:
                        json_format:
                          service_name: "{{ $.OTel.ServiceName }}"
                          agent_id: "{{ $.OTel.AgentID }}"
                          chain: l4_authz_passthrough
                          start_time: "%START_TIME%"
                          requested_server_name: "%REQUESTED_SERVER_NAME%"
                          upstream_host: "%UPSTREAM_HOST%"
                          response_flags: "%RESPONSE_FLAGS%"
                          duration_ms: "%DURATION%"
                          bytes_received: "%BYTES_RECEIVED%"
                          bytes_sent: "%BYTES_SENT%"
                  - name: envoy.access_loggers.open_telemetry
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.access_loggers.open_telemetry.v3.OpenTelemetryAccessLogConfig
{{- if $.OTel.GRPC }}
                      grpc_service:
                        envoy_grpc:
                          cluster_name: otel_export
                        timeout: 5s
{{- else }}
                      http_service:
                        http_uri:
                          uri: "{{ $.OTel.LogsURI }}"
                          cluster: otel_export
                          timeout: 5s
{{- end }}
                      stat_prefix: l4
                      disable_builtin_labels: true
                      resource_attributes:
                        values:
                          - key: service.name
                            value: { string_value: "{{ $.OTel.ServiceName }}" }
                          - key: platform.gateway.id
                            value: { string_value: "{{ $.OTel.AgentID }}" }
                      body:
                        string_value: "SNI %REQUESTED_SERVER_NAME%"
                      attributes:
                        values:
                          - key: chain
                            value: { string_value: l4_authz_passthrough }
                          - key: requested_server_name
                            value: { string_value: "%REQUESTED_SERVER_NAME%" }
                          - key: upstream_host
                            value: { string_value: "%UPSTREAM_HOST%" }
                          - key: response_flags
                            value: { string_value: "%RESPONSE_FLAGS%" }
                          - key: duration_ms
                            value: { string_value: "%DURATION%" }
                          - key: bytes_received
                            value: { string_value: "%BYTES_RECEIVED%" }
                          - key: bytes_sent
                            value: { string_value: "%BYTES_SENT%" }
{{- end }}

  clusters:
    - name: tls_inspect_internal
      connect_timeout: 1s
      load_assignment:
        cluster_name: tls_inspect_internal
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    envoy_internal_address:
                      server_listener_name: tls_inspect_internal

    - name: dynamic_forward_proxy_https
      connect_timeout: 5s
      lb_policy: CLUSTER_PROVIDED
      cluster_type:
        name: envoy.clusters.dynamic_forward_proxy
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig
          dns_cache_config:
            name: dns_cache
            dns_lookup_family: V4_PREFERRED
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          common_tls_context:
            validation_context:
              # Trust the host's system root CA bundle. envoy-distroless ships
              # one at /etc/ssl/certs/ca-certificates.crt; we point at it
              # explicitly because system_root_certs is gated behind a runtime
              # flag in 1.32.
              trusted_ca:
                filename: /etc/ssl/certs/ca-certificates.crt

    - name: dynamic_forward_proxy_tcp
      connect_timeout: 5s
      lb_policy: CLUSTER_PROVIDED
      cluster_type:
        name: envoy.clusters.dynamic_forward_proxy
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig
          dns_cache_config:
            name: dns_cache
            dns_lookup_family: V4_PREFERRED

    # Plain-HTTP forward cluster. Used by the
    # outer HCM's fallthrough route to forward proxied non-CONNECT
    # requests after the HCM's L7 ext_authz applies the same
    # path/method rules used on TLS-terminated chains. No TLS —
    # plaintext is already on the wire.
    - name: dynamic_forward_proxy_http
      connect_timeout: 5s
      lb_policy: CLUSTER_PROVIDED
      cluster_type:
        name: envoy.clusters.dynamic_forward_proxy
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.clusters.dynamic_forward_proxy.v3.ClusterConfig
          dns_cache_config:
            name: dns_cache
            dns_lookup_family: V4_PREFERRED

    # Pinned TCP-passthrough upstream for harness CONNECT tunnels. STRICT_DNS
    # so Envoy resolves at refresh cadence; the destination is fixed in
    # config — the inner bytes after CONNECT cannot redirect Envoy elsewhere
    # the way an inner Host header could on the absolute-URI route. ztunnel
    # picks up the outbound TCP socket from the gateway pod and encapsulates
    # it with the gateway's SPIFFE principal for the waypoint policy check.
    - name: harness_passthrough
      connect_timeout: 5s
      type: STRICT_DNS
      dns_lookup_family: V4_PREFERRED
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: harness_passthrough
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: {{ $.HarnessHost }}
                      port_value: {{ $.HarnessPort }}

{{- range $chain := .Chains }}
{{- if $chain.Credentialed }}

    # Pinned upstream for the credentialed chain matching SNI={{ $chain.Host }}.
    # STRICT_DNS resolves {{ $chain.Host }}:443 directly; the agent's Host
    # header plays no role in destination selection. Upstream TLS hard-binds
    # SNI and validates the upstream cert's SAN against {{ $chain.Host }},
    # so even a poisoned cache or misrouted endpoint fails the handshake
    # before any credentialed body is on the wire.
    #
    # dns_lookup_family is set explicitly because STRICT_DNS defaults to
    # AUTO (IPv6-first); clusters whose pods lack IPv6 egress would fail
    # with "Network is unreachable" before the credentialed body lands on
    # the wire. Mirrors the V4_PREFERRED choice used by every other DNS
    # cluster in this bootstrap.
    - name: {{ $chain.UpstreamCluster }}
      connect_timeout: 5s
      type: STRICT_DNS
      dns_lookup_family: V4_PREFERRED
      lb_policy: ROUND_ROBIN
{{- if $chain.HTTP2 }}
      # gRPC chain: mirror the downstream-negotiated protocol upstream (h2 for
      # gRPC, h1 otherwise) so credential injection applies to the gRPC stream
      # and Envoy forwards HTTP/2 to the real host. Envoy auto-sets upstream
      # ALPN to match. REST chains omit this and stay HTTP/1.1.
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          use_downstream_protocol_config:
            http_protocol_options: {}
            http2_protocol_options: {}
{{- end }}
      load_assignment:
        cluster_name: {{ $chain.UpstreamCluster }}
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: {{ $chain.Host }}
                      port_value: 443
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          sni: {{ $chain.Host }}
          auto_host_sni: false
          common_tls_context:
            validation_context:
              trusted_ca:
                filename: /etc/ssl/certs/ca-certificates.crt
              match_typed_subject_alt_names:
                - san_type: DNS
                  matcher:
                    exact: {{ $chain.Host }}
{{- end }}
{{- end }}
{{- if .Telemetry }}

    # Pinned plaintext upstream for the telemetry collector chain. STRICT_DNS
    # resolves {{ .TelemetryCollectorHost }}:{{ .TelemetryCollectorPort }}
    # directly; the agent's Host header plays no role in destination selection.
    # No upstream TLS — the collector is in-cluster and ztunnel wraps the
    # gateway→collector hop in mTLS transparently. dns_lookup_family is set
    # explicitly (STRICT_DNS defaults to IPv6-first AUTO) to match every other
    # DNS cluster in this bootstrap.
    - name: otel_collector
      connect_timeout: 5s
      type: STRICT_DNS
      dns_lookup_family: V4_PREFERRED
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: otel_collector
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: {{ .TelemetryCollectorHost }}
                      port_value: {{ .TelemetryCollectorPort }}
{{- end }}

    # Single gRPC ext_authz cluster: both Envoy filters (HTTP on
    # TLS-terminated chains, network on the catch-all) call the same
    # api-server endpoint. typed_extension_protocol_options forces HTTP/2
    # framing so Envoy speaks gRPC instead of HTTP/1.1.
    - name: ext_authz_cluster
      connect_timeout: 1s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          explicit_http_config:
            http2_protocol_options: {}
      load_assignment:
        cluster_name: ext_authz_cluster
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: {{ $.ExtAuthzHost }}
                      port_value: {{ $.ExtAuthzPort }}
{{- if $.OTel.Collector }}

    # OTLP exporter target for the gateway's OWN traces and metrics, dialed
    # from the relayed OTEL_EXPORTER_OTLP_ENDPOINT. Distinct from the
    # otel_collector cluster above, which forwards the AGENT's telemetry
    # (same backend, different config source and possibly port/transport).
    # Rendered only when telemetry is on. Plaintext over the ambient mesh
    # (ztunnel encrypts the hop); reachability is subject to the mesh
    # AuthorizationPolicy on the collector. HTTP/2 framing for OTLP/gRPC;
    # OTLP/HTTP leaves the cluster at its HTTP/1.1 default.
    - name: otel_export
      # 5s matches the transit cluster and the tracer/sink request timeouts;
      # export is background work where a fast-fail only drops the batch, and
      # with $.OTel.Secure the connect budget covers the TLS handshake too.
      connect_timeout: 5s
      type: STRICT_DNS
      dns_lookup_family: V4_PREFERRED
      lb_policy: ROUND_ROBIN
{{- if $.OTel.GRPC }}
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          explicit_http_config:
            http2_protocol_options: {}
{{- end }}
      load_assignment:
        cluster_name: otel_export
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: {{ $.OTel.CollectorHost }}
                      port_value: {{ $.OTel.CollectorPort }}
{{- if $.OTel.Secure }}
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          sni: {{ $.OTel.CollectorHost }}
          common_tls_context:
            validation_context:
              trusted_ca:
                filename: /etc/ssl/certs/ca-certificates.crt
{{- end }}
{{- end }}
`

// envoyListenAddress is the bind address for the gateway pod's outer listener.
// 0.0.0.0 — reach is gated by the gateway pod's NetworkPolicy (ingress admitted
// only from the paired agent pod), not the bind address.
const envoyListenAddress = "0.0.0.0"

// gatewayOTelServiceName is the shared trace/metric service.name for every
// gateway. Kept shared (per-gateway identity rides as the bounded
// `platform.gateway.id`
// resource attribute) so trace and metric cardinality don't scale with the
// agent count.
const gatewayOTelServiceName = "platform-agent-gateway"

// envoyOTelView is the template-facing projection of the controller's relayed
// OpenTelemetry environment, driving the gateway's OWN telemetry (traces,
// access logs, stats). Distinct from the `.Telemetry` transit chain, which
// forwards the agent's telemetry. When the environment carries no OTLP
// endpoint the zero value renders nothing, so the gateway behaves exactly as a
// non-instrumented platform.
type envoyOTelView struct {
	Traces          bool
	AccessLogs      bool
	Metrics         bool    // OTel stats sink is gRPC-only; off when the exporter is OTLP/HTTP
	Collector       bool    // render the otel_export cluster — a traces/metrics dependency
	Secure          bool    // collector endpoint is https → wrap the cluster in upstream TLS
	GRPC            bool    // exporter cluster is http2 (OTLP/gRPC) vs HTTP/1.1 (OTLP/HTTP)
	SamplingPercent float64 // HCM random_sampling, from OTEL_TRACES_SAMPLER[/_ARG]
	ServiceName     string
	AgentID         string
	CollectorHost   string
	CollectorPort   int
	TracesURI       string // OTLP/HTTP traces endpoint (only when !GRPC)
	LogsURI         string // OTLP/HTTP logs endpoint (only when !GRPC)
}

// newEnvoyOTelView derives the gateway's telemetry config from the OTLP
// exporter the controller inherited (chart-set under `clickstack.enabled`, or
// injected). `instanceName` is the gateway's own identity (agent or fork
// name), emitted as `platform.gateway.id`. When no endpoint is set, telemetry
// is off.
func newEnvoyOTelView(instanceName string, cfg *config.Config) envoyOTelView {
	exp, ok := cfg.OTelExporter()
	if !ok {
		return envoyOTelView{}
	}
	v := envoyOTelView{
		Traces:          true,
		AccessLogs:      true,
		Metrics:         exp.GRPC, // Envoy's OTel stats sink only speaks OTLP/gRPC
		Collector:       true,
		Secure:          exp.Secure,
		GRPC:            exp.GRPC,
		SamplingPercent: cfg.TraceSamplingPercent(),
		ServiceName:     gatewayOTelServiceName,
		AgentID:         instanceName,
		CollectorHost:   exp.Host,
		CollectorPort:   exp.Port,
	}
	if !exp.GRPC {
		scheme := "http"
		if exp.Secure {
			scheme = "https"
		}
		v.TracesURI = fmt.Sprintf("%s://%s:%d/v1/traces", scheme, exp.Host, exp.Port)
		v.LogsURI = fmt.Sprintf("%s://%s:%d/v1/logs", scheme, exp.Host, exp.Port)
	}
	return v
}

// renderEnvoyBootstrap returns the Envoy bootstrap YAML for an instance's
// paired gateway pod.
//
// `instanceID` is this gateway's *own* instance (agent or fork name); it is
// the value stamped into the trusted `x-platform-agent-id` telemetry header
// and emitted as the bounded `platform.gateway.id` attribute on the gateway's
// own telemetry.
// `extAuthzInstanceID` is the instance whose per-instance ext-authz Service
// the gateway dials. For long-lived pairs the two are equal; for forks
// `extAuthzInstanceID` is the *parent* instance's ID — fork pods run as their
// *own* per-fork SA, but the parent owner's HITL rules should gate fork
// egress, so the fork's gateway dials the parent's per-instance ext-authz
// Service (admitted via `BuildForkExtAuthzAuthorizationPolicy`). The telemetry
// header, by contrast, must carry the fork's own `instanceID` so its telemetry
// attributes to the fork, not the parent.
func renderEnvoyBootstrap(instanceID, extAuthzInstanceID string, cfg *config.Config, chains []envoyHostChain) (string, error) {
	tmpl, err := template.New("envoy").Parse(envoyBootstrapTmpl)
	if err != nil {
		return "", err
	}
	// Envoy's per-call timeout sits ahead of the application-level hold so a
	// hold-window timeout fires from the api-server side, not from Envoy.
	extAuthzTimeoutSeconds := cfg.ExtAuthzHoldSeconds + 60
	// :authority value the harness Service is reached on. The agent
	// builds harness URLs from cfg.HarnessServerURL (`<rel>-apiserver-harness`),
	// so the Host/:authority includes the port. We match on
	// this exact string so the harness route is scoped to api-server
	// traffic only — fall-through goes through the regular egress paths.
	harnessAuthority := fmt.Sprintf("%s:%d", cfg.HarnessHost(), cfg.HarnessServerPort)
	// Render the telemetry collector chain only when the backend is configured
	// AND the collector host doesn't collide with a credentialed chain host —
	// two filter chains sharing `server_names` is a fatal Envoy config error.
	// A collision isn't expected in practice (the collector host is an internal
	// Service DNS no agent would be granted a credential for), but guard
	// structurally rather than crash-loop the gateway. The credentialed chain
	// for that host still wins, and the host is in the leaf SAN regardless.
	telemetry := cfg.TelemetryEnabled() && !hostInChains(chains, cfg.TelemetryCollectorHost)
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, struct {
		ListenAddress          string
		Port                   int
		Chains                 []envoyHostChain
		CredentialsRoot        string
		CredentialSDSName      string
		LeafTLSDir             string
		HarnessAuthority       string
		HarnessHost            string
		HarnessPort            int
		HealthPath             string
		ExtAuthzHost           string
		ExtAuthzPort           int
		ExtAuthzHoldSeconds    int
		ExtAuthzTimeoutSeconds int
		Telemetry              bool
		TelemetryCollectorHost string
		TelemetryCollectorPort int
		InstanceID             string
		OTel                   envoyOTelView
	}{
		ListenAddress:          envoyListenAddress,
		Port:                   cfg.EnvoyPort,
		Chains:                 chains,
		CredentialsRoot:        envoyCredentialsRoot,
		CredentialSDSName:      envoyCredentialSDSName,
		LeafTLSDir:             envoyLeafTLSMount,
		HarnessAuthority:       harnessAuthority,
		HealthPath:             platformGatewayHealthPath,
		HarnessHost:            cfg.HarnessHost(),
		HarnessPort:            cfg.HarnessServerPort,
		ExtAuthzHost:           cfg.ExtAuthzHostFor(extAuthzInstanceID),
		ExtAuthzPort:           cfg.ExtAuthzPort,
		ExtAuthzHoldSeconds:    cfg.ExtAuthzHoldSeconds,
		ExtAuthzTimeoutSeconds: extAuthzTimeoutSeconds,
		Telemetry:              telemetry,
		TelemetryCollectorHost: cfg.TelemetryCollectorHost,
		TelemetryCollectorPort: cfg.TelemetryCollectorPort,
		InstanceID:             instanceID,
		OTel:                   newEnvoyOTelView(instanceID, cfg),
	}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// BuildEnvoyBootstrapConfigMap is the desired ConfigMap holding the rendered
// Envoy bootstrap YAML for an instance.
//
// `extAuthzInstanceID` is the instance whose per-instance ext-authz Service
// the gateway dials. Long-lived pairs pass `instanceName` for
// both args; forks pass the parent instance ID for the second.
func BuildEnvoyBootstrapConfigMap(instanceName, extAuthzInstanceID string, cfg *config.Config, ownerRef metav1.OwnerReference, secrets []corev1.Secret) (*corev1.ConfigMap, error) {
	chains := chainsFromSecrets(secrets)
	yaml, err := renderEnvoyBootstrap(instanceName, extAuthzInstanceID, cfg, chains)
	if err != nil {
		return nil, err
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            EnvoyBootstrapName(instanceName),
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: instanceName},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Data: map[string]string{"envoy.yaml": yaml},
	}, nil
}

// envoyVolumes returns the pod-level volumes that back the gateway pod's
// bootstrap ConfigMap, per-Secret credential files, and the cert-manager-issued
// TLS leaf used to terminate the agent's intercepted TLS. None of these are
// referenced from the agent pod — the credential boundary lives at the pod
// boundary.
func envoyVolumes(instanceName string, cfg *config.Config, secrets []corev1.Secret) []corev1.Volume {
	volumes := []corev1.Volume{{
		Name: envoyBootstrapVolume,
		VolumeSource: corev1.VolumeSource{
			ConfigMap: &corev1.ConfigMapVolumeSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: EnvoyBootstrapName(instanceName)},
			},
		},
	}}
	for _, s := range secrets {
		// Allow-only Secrets carry no credential payload; the bootstrap
		// template skips credential_injector for them, so there's nothing
		// to mount.
		if s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
			continue
		}
		volumes = append(volumes, corev1.Volume{
			Name: "cred-" + s.Name,
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{SecretName: s.Name},
			},
		})
	}
	// Leaf cert is required whenever ANY TLS-terminating chain exists:
	// allow-only or credentialed chains (both gate the request), or the
	// telemetry collector chain (it MITM-terminates the collector SNI even
	// when the instance has no credential Secrets).
	if len(secrets) > 0 || cfg.TelemetryEnabled() {
		volumes = append(volumes, corev1.Volume{
			Name: envoyLeafTLSVolume,
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: EnvoyLeafSecretName(instanceName),
					// Don't require — cert-manager fills this Secret asynchronously.
					// Pod will block on volume mount until the Secret exists.
					Optional: ptrBool(false),
				},
			},
		})
	}
	return volumes
}

func ptrBool(b bool) *bool { return &b }

// envoyBootstrapTemplateRev is folded into envoySecretsRev so that
// structural changes to the bootstrap template (new clusters, route shape
// changes, etc.) force existing pods to roll on chart upgrade — without it,
// the rendered ConfigMap diverges but the pod template stays identical and
// kubelet keeps the old bootstrap mounted.
//
// Bump on any template change that affects pod-visible behavior.
const envoyBootstrapTemplateRev = "v13-gateway-otel"

// envoySecretsRev digests the Secret set that drives Envoy's chain
// rendering. Includes `injection-hosts` JSON so a descriptor change
// (host added / removed / retargeted on a connection) rolls the gateway —
// Envoy reads the bootstrap once at boot, so without a roll the chain
// shape goes stale. The SDS data-key set is included too: chain rendering
// degrades a host to allow-only when its SDS key is missing, so a Secret
// gaining (or losing) an SDS key changes the chain shape and must roll.
func envoySecretsRev(secrets []corev1.Secret) string {
	parts := []string{"tmpl=" + envoyBootstrapTemplateRev}
	for _, s := range secrets {
		parts = append(parts, fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s",
			s.Name,
			s.Annotations[envoyHostPatternAnn],
			s.Labels[envoySecretTypeLabel],
			s.Annotations[envoyHeaderNameAnn],
			s.Annotations[envoyQueryParamAnn],
			s.Annotations[envoyInjectionHostsAnn],
			strings.Join(sdsDataKeys(s), ","),
		))
	}
	sort.Strings(parts[1:])
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:8])
}

// sdsDataKeys returns the sorted SDS file keys present in a Secret's data —
// the only data keys that shape chain rendering (token fields hot-reload
// via SDS and never require a roll).
func sdsDataKeys(s corev1.Secret) []string {
	var keys []string
	for k := range s.Data {
		if k == envoyCredentialKeySDS || strings.HasSuffix(k, ".sds.yaml") {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

// envoyContainer returns the gateway pod's Envoy container spec. Drops all caps,
// ReadOnlyRootFilesystem; mounts only the bootstrap CM and the owner's
// credential Secrets. Used as the sole non-init container of the paired
// gateway pod.
func envoyContainer(instanceName string, cfg *config.Config, secrets []corev1.Secret) corev1.Container {
	mounts := []corev1.VolumeMount{{
		Name:      envoyBootstrapVolume,
		MountPath: envoyBootstrapMount,
		ReadOnly:  true,
	}}
	for _, s := range secrets {
		if s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
			continue
		}
		mounts = append(mounts, corev1.VolumeMount{
			Name:      "cred-" + s.Name,
			MountPath: envoyCredentialsRoot + "/cred-" + s.Name,
			ReadOnly:  true,
		})
	}
	if len(secrets) > 0 || cfg.TelemetryEnabled() {
		mounts = append(mounts, corev1.VolumeMount{
			Name:      envoyLeafTLSVolume,
			MountPath: envoyLeafTLSMount,
			ReadOnly:  true,
		})
	}
	c := corev1.Container{
		Name:            "envoy",
		Image:           cfg.EnvoyImage,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Args: []string{
			"--config-path", envoyBootstrapMount + "/envoy.yaml",
			"--log-level", "info",
		},
		VolumeMounts: mounts,
		Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("50m"),
				corev1.ResourceMemory: resource.MustParse("64Mi"),
			},
		},
		SecurityContext: &corev1.SecurityContext{
			Capabilities:           &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
			ReadOnlyRootFilesystem: ptrBool(true),
			RunAsNonRoot:           ptrBool(true),
		},
	}
	c.Env = gatewayOTelEnv(instanceName, cfg)
	return c
}

// gatewayOTelEnv relays the controller's inherited OTEL_* environment onto the
// gateway Envoy container so OpenTelemetry resource attributes, sampling, and
// transport settings flow through generically — the controller never
// enumerates them. The gateway's own identity overrides the controller's:
// platform.gateway.id and the pod namespace go into OTEL_RESOURCE_ATTRIBUTES
// (read by Envoy's environment resource detector), while service.name stays shared and is
// owned by the tracer config, so OTEL_SERVICE_NAME is not relayed. Keys are
// sorted so the pod spec is stable across reconciles. A change to any relayed
// var also rolls the gateway pod, which is what re-reads the re-rendered
// bootstrap. Returns nil when the platform's instrumentation is off, leaving
// the gateway exactly as it was.
func gatewayOTelEnv(instanceName string, cfg *config.Config) []corev1.EnvVar {
	if !cfg.OTelEnabled() {
		return nil
	}
	// Effective exporter pair: the gateway-specific override (when set) beats
	// the relayed values, so the pod env states what the bootstrap actually
	// dials — and an override change rolls the pod like any other env change.
	effective := map[string]string{}
	if cfg.GatewayOTLPEndpoint != "" {
		effective["OTEL_EXPORTER_OTLP_ENDPOINT"] = cfg.GatewayOTLPEndpoint
		proto := cfg.GatewayOTLPProtocol
		if proto == "" {
			proto = "grpc"
		}
		effective["OTEL_EXPORTER_OTLP_PROTOCOL"] = proto
	}
	keys := make([]string, 0, len(cfg.OTelEnv)+len(effective))
	for k := range cfg.OTelEnv {
		// Drop the controller's own identity vars; the gateway sets its own.
		if k == "OTEL_RESOURCE_ATTRIBUTES" || k == "OTEL_SERVICE_NAME" {
			continue
		}
		// Drop the OTLP *_HEADERS family: Envoy can't read collector auth from
		// env (it needs the header in exporter config), so relaying it is inert
		// and would needlessly spread any collector credential onto gateway pods.
		// Collector auth here is transport-level (mesh mTLS), not header-based.
		if strings.HasSuffix(k, "HEADERS") {
			continue
		}
		if _, ok := effective[k]; ok {
			continue
		}
		keys = append(keys, k)
	}
	for k := range effective {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	env := make([]corev1.EnvVar, 0, len(keys)+1)
	for _, k := range keys {
		v, ok := effective[k]
		if !ok {
			v = cfg.OTelEnv[k]
		}
		env = append(env, corev1.EnvVar{Name: k, Value: v})
	}
	env = append(env, corev1.EnvVar{
		// platform.gateway.id, not agent.id: observability.md reserves the
		// platform.* namespace because agent.* is agent-forgeable (an agent
		// can export any agent.id resource attribute through the transit
		// chain — only platform.agent.id is collector-sanitized). This key
		// survives the collector untouched and stays trustworthy.
		Name:  "OTEL_RESOURCE_ATTRIBUTES",
		Value: fmt.Sprintf("platform.gateway.id=%s,k8s.namespace.name=%s", instanceName, cfg.Namespace),
	})
	return env
}
