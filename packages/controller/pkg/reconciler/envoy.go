package reconciler

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"text/template"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Envoy sidecar wiring for the experimental credential-injector path (ADR-033).
//
// Scope of #337: Envoy proxies all egress for the agent container. Per-Secret
// routes inject a credential under the configured header for the matching host.
// The credential file content is produced by the api-server's K8sSecretsPort
// (which bakes any header prefix into the file) and read verbatim by Envoy's
// generic credential source. SDS hot-reload picks up file changes without a
// restart; topology changes (new/removed Secrets, host edits) regenerate the
// bootstrap ConfigMap and roll the StatefulSet.

const (
	envoyOwnerLabel       = "agent-platform.ai/owner"
	envoyManagedByLabel   = "agent-platform.ai/managed-by"
	envoySecretTypeLabel  = "agent-platform.ai/secret-type"
	envoyConnectionLabel  = "agent-platform.ai/connection"
	// Non-connection Secrets: single injection target via these.
	envoyHostPatternAnn   = "agent-platform.ai/host-pattern"
	envoyHeaderNameAnn    = "agent-platform.ai/injection-header-name"
	envoyQueryParamAnn    = "agent-platform.ai/injection-query-param"
	envoyAuthModeAnn      = "agent-platform.ai/auth-mode"
	// Connection Secrets: N injection targets as JSON. Issue #219. (The
	// api-server also stamps `agent-platform.ai/host-patterns` for kubectl
	// readability; the controller doesn't read it.)
	envoyInjectionHostsAnn = "agent-platform.ai/injection-hosts"
	// JSON-encoded list of {envName, placeholder} the api-server stamps on a
	// user-typed credential Secret. Authoritative source for the env vars
	// the agent harness needs as placeholders (ADR-041). Connection-type
	// Secrets do not write this annotation today and fall through to the
	// hardcoded mapping in `credentialEnvVars` below.
	envoyEnvMappingsAnn   = "agent-platform.ai/env-mappings"
	// Per-agent grant annotations stamped by the api-server on the
	// instance ConfigMap. The controller reads them on every reconcile
	// and intersects with the owner's credential Secret list. Both lists
	// are always selective: an absent annotation reads as an empty grant
	// set, never "all granted".
	grantSecretIdsAnn         = "agent-platform.ai/granted-secret-ids"
	grantConnectionIdsAnn     = "agent-platform.ai/granted-connection-ids"
	credentialSecretNamePrefix = "platform-cred-"
	envoyBootstrapVolume  = "envoy-bootstrap"
	envoyBootstrapMount   = "/etc/envoy"
	envoyCredentialsRoot   = "/etc/envoy/credentials"
	envoyCredentialKeySDS  = "sds.yaml"  // SDS DiscoveryResponse file (expected by path_config_source)
	envoyCredentialSDSName = "credential" // SDS resource name produced by api-server's K8sSecretsPort
	envoyLeafTLSVolume     = "envoy-tls"
	envoyLeafTLSMount      = "/etc/envoy/tls"
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
	// Secrets use `sds.yaml`; connection Secrets use `host-<sha8>.sds.yaml`
	// so one Secret carries N chains' credentials (issue #219).
	SDSFileKey string
}

// envoyHostChain is one TLS-terminating filter chain. `Credentials` is
// the per-Secret injection list applied to every request through the
// chain, in deterministic order (Secrets are name-sorted upstream). Empty
// `Credentials` is the allow-only / MITM-only flavor (ADR-035): the host
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
	// redirect the credentialed body to an attacker-controlled upstream
	// (ADR-033 §Threat Model).
	UpstreamCluster string
}

// Credentialed reports whether the chain has any credential injections.
// Allow-only chains (no credentials) skip credential_injector and forward
// via dynamic_forward_proxy — there's no credential to misroute.
func (c envoyHostChain) Credentialed() bool { return len(c.Credentials) > 0 }

// envoySecretTypeAllowOnly marks Secrets that exist solely to extend the
// cert SAN list and force a host onto the L7 path so path-specific egress
// rules can be enforced. They carry no credential payload.
const envoySecretTypeAllowOnly = "allow-only"

// listAgentCredentialSecrets returns the owner's credential Secrets filtered
// by the per-agent grant annotations on the instance ConfigMap. See
// `filterByGrants` for the precise semantics.
func listAgentCredentialSecrets(ctx context.Context, client kubernetes.Interface, namespace, owner string, agentCM *corev1.ConfigMap) ([]corev1.Secret, error) {
	all, err := listOwnerCredentialSecrets(ctx, client, namespace, owner)
	if err != nil {
		return nil, err
	}
	return filterByGrants(all, agentCM.Annotations), nil
}

// filterByGrants narrows the owner's credential Secret list using the agent's
// grant annotations. Both lists are always selective: only Secrets whose
// identifier appears in the relevant annotation are mounted into the
// sidecar.
//
//   - Regular secrets (`agent-platform.ai/secret-type` ∈ {anthropic, generic}):
//     keyed by the id suffix after `platform-cred-`, looked up in
//     `agent-platform.ai/granted-secret-ids`.
//   - Connection secrets (`agent-platform.ai/secret-type` = connection):
//     keyed by `agent-platform.ai/connection`, looked up in
//     `agent-platform.ai/granted-connection-ids`.
//
// Absent or empty annotations result in an empty intersection.
func filterByGrants(secrets []corev1.Secret, ann map[string]string) []corev1.Secret {
	grantedSecretIds := splitGrant(ann[grantSecretIdsAnn])
	grantedConnIds := splitGrant(ann[grantConnectionIdsAnn])

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

	// ADR-041: a granted-id that doesn't resolve to an owner-owned Secret
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

func splitGrant(raw string) map[string]bool {
	out := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
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

// hasGHTokenEnv reports whether any granted Secret declares `GH_TOKEN`
// in its env-mappings. Used to set `PLATFORM_GH_TOKEN_AVAILABLE` and to
// gate the no-credential warning — replaces a hardcoded github-host
// check with a derivation from the declarative env-mapping spec.
func hasGHTokenEnv(secrets []corev1.Secret) bool {
	for _, e := range credentialEnvVars(secrets) {
		if e.Name == "GH_TOKEN" {
			return true
		}
	}
	return false
}

// connectionHostInjection mirrors the TS `ConnectionHostInjection`
// persisted on the `injection-hosts` annotation. Decoded once per Secret
// and fanned out by `chainsFromSecrets`.
type connectionHostInjection struct {
	Host        string `json:"host"`
	PathPattern string `json:"pathPattern,omitempty"`
	HeaderName  string `json:"headerName,omitempty"`
	ValueFormat string `json:"valueFormat,omitempty"`
	Encoding    string `json:"encoding,omitempty"`
}

// sdsFileKeyForHost mirrors the api-server's `sdsFileKeyForHost`. MUST
// stay byte-identical — pinned by tests on both sides. SHA-1 is
// non-cryptographic use.
func sdsFileKeyForHost(host string) string {
	h := sha1.Sum([]byte(host)) // #nosec G401 — non-cryptographic
	return "host-" + hex.EncodeToString(h[:])[:8] + ".sds.yaml"
}

// expandConnectionSecret turns a connection Secret into one (host, cred)
// pair per entry in its `injection-hosts` JSON. Non-connection Secrets
// remain single-host (handled by the caller).
type hostCredential struct {
	host string
	cred envoyCredential
}

func expandConnectionSecret(s corev1.Secret) []hostCredential {
	entries := parseConnectionHosts(s)
	if len(entries) == 0 {
		return nil
	}
	// Dedup hosts inside one Secret — descriptor bugs or migration
	// quirks can list the same host twice; emitting two chains for the
	// same SNI would crash Envoy with duplicate filter chains.
	seenHost := map[string]struct{}{}
	out := make([]hostCredential, 0, len(entries))
	for _, e := range entries {
		if e.Host == "" {
			continue
		}
		if _, dup := seenHost[e.Host]; dup {
			slog.Warn("duplicate host in injection-hosts; skipping later entry",
				"namespace", s.Namespace, "secret", s.Name, "host", e.Host)
			continue
		}
		seenHost[e.Host] = struct{}{}
		header := e.HeaderName
		if header == "" {
			header = "Authorization"
		}
		out = append(out, hostCredential{
			host: e.Host,
			cred: envoyCredential{
				SecretName: s.Name,
				HeaderName: header,
				VolumeName: "cred-" + s.Name,
				SDSFileKey: sdsFileKeyForHost(e.Host),
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
		first       string // first Secret name encountered for this host (drives ChainID)
	}
	byHost := map[string]*bucket{}
	order := []string{}

	add := func(host, secretName string, cred *envoyCredential) {
		if host == "" {
			return
		}
		b := byHost[host]
		if b == nil {
			b = &bucket{host: host, seenHeader: map[string]string{}, first: secretName}
			byHost[host] = b
			order = append(order, host)
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
				add(hc.host, s.Name, &cred)
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
		if s.Labels[envoySecretTypeLabel] == envoySecretTypeAllowOnly {
			add(host, s.Name, nil)
			continue
		}
		cred := envoyCredential{
			SecretName:     s.Name,
			HeaderName:     s.Annotations[envoyHeaderNameAnn],
			QueryParamName: s.Annotations[envoyQueryParamAnn],
			VolumeName:     "cred-" + s.Name,
			SDSFileKey:     envoyCredentialKeySDS,
		}
		add(host, s.Name, &cred)
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

// Bootstrap template — TLS-intercepting CONNECT proxy.
//
// Topology (ADR-038):
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
//      route-confusion exfiltration path called out in ADR-033 §Threat Model
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

const envoyBootstrapTmpl = `node:
  id: platform-credential-injector
  cluster: platform-credential-injector
bootstrap_extensions:
  - name: envoy.bootstrap.internal_listener
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.bootstrap.internal_listener.v3.InternalListener
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
                upgrade_configs:
                  - upgrade_type: CONNECT
                http_filters:
                  # Gate plain-HTTP egress (ADR-035). The
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
                          # ADR-041: pin :authority to the per-instance
                          # ext-authz Service hostname. Without this,
                          # Envoy's default :authority is the cluster
                          # name and the api-server cannot derive
                          # instance ID from it.
                          authority: "{{ $.ExtAuthzHost }}"
                        # ADR-041: instance identity is conveyed by the
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
                        # ADR-041: identity is conveyed by the SPIFFE
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
                tls_certificates:
                  - certificate_chain: { filename: {{ $.LeafTLSDir }}/tls.crt }
                    private_key:      { filename: {{ $.LeafTLSDir }}/tls.key }
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: terminate_{{ $chain.ChainID }}
                http_filters:
                  # HITL gate (ADR-035). gRPC ext_authz to the
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
                          # ADR-041: pin :authority to the per-instance
                          # ext-authz Service hostname. Without this,
                          # Envoy's default :authority is the cluster
                          # name and the api-server cannot derive
                          # instance ID from it.
                          authority: "{{ $.ExtAuthzHost }}"
                        # ADR-041: instance identity is conveyed by the
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
                    # ADR-041: pin :authority to the per-instance
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

    # Plain-HTTP forward cluster (ADR-035). Used by the
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
`

// envoyListenAddress is the bind address for the gateway pod's outer listener.
// 0.0.0.0 — reach is gated by the gateway pod's NetworkPolicy (ingress admitted
// only from the paired agent pod), not the bind address. ADR-038.
const envoyListenAddress = "0.0.0.0"

// renderEnvoyBootstrap returns the Envoy bootstrap YAML for an instance's
// paired gateway pod.
//
// `extAuthzInstanceID` is the instance whose per-instance ext-authz Service
// the gateway dials (ADR-041). For long-lived pairs this equals the
// instance name; for forks it is the parent instance's ID — fork pods
// run as their *own* per-fork SA (ADR-027), but the parent owner's HITL
// rules should gate fork egress, so the fork's gateway dials the parent's
// per-instance ext-authz Service. The fork SA is admitted there via a
// separate per-fork AuthorizationPolicy (`BuildForkExtAuthzAuthorizationPolicy`).
func renderEnvoyBootstrap(extAuthzInstanceID string, cfg *config.Config, chains []envoyHostChain) (string, error) {
	tmpl, err := template.New("envoy").Parse(envoyBootstrapTmpl)
	if err != nil {
		return "", err
	}
	// Envoy's per-call timeout sits ahead of the application-level hold so a
	// hold-window timeout fires from the api-server side, not from Envoy.
	extAuthzTimeoutSeconds := cfg.ExtAuthzHoldSeconds + 60
	// :authority value the harness Service is reached on. The agent
	// builds harness URLs from cfg.HarnessServerURL (`<rel>-apiserver-harness`
	// per ADR-041), so the Host/:authority includes the port. We match on
	// this exact string so the harness route is scoped to api-server
	// traffic only — fall-through goes through the regular egress paths.
	harnessAuthority := fmt.Sprintf("%s:%d", cfg.HarnessHost(), cfg.HarnessServerPort)
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
		ExtAuthzHost           string
		ExtAuthzPort           int
		ExtAuthzHoldSeconds    int
		ExtAuthzTimeoutSeconds int
	}{
		ListenAddress:          envoyListenAddress,
		Port:                   cfg.EnvoyPort,
		Chains:                 chains,
		CredentialsRoot:        envoyCredentialsRoot,
		CredentialSDSName:      envoyCredentialSDSName,
		LeafTLSDir:             envoyLeafTLSMount,
		HarnessAuthority:       harnessAuthority,
		HarnessHost:            cfg.HarnessHost(),
		HarnessPort:            cfg.HarnessServerPort,
		ExtAuthzHost:           cfg.ExtAuthzHostFor(extAuthzInstanceID),
		ExtAuthzPort:           cfg.ExtAuthzPort,
		ExtAuthzHoldSeconds:    cfg.ExtAuthzHoldSeconds,
		ExtAuthzTimeoutSeconds: extAuthzTimeoutSeconds,
	}); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// BuildEnvoyBootstrapConfigMap is the desired ConfigMap holding the rendered
// Envoy bootstrap YAML for an instance.
//
// `extAuthzInstanceID` is the instance whose per-instance ext-authz Service
// the gateway dials (ADR-041). Long-lived pairs pass `instanceName` for
// both args; forks pass the parent instance ID for the second.
func BuildEnvoyBootstrapConfigMap(instanceName, extAuthzInstanceID string, cfg *config.Config, ownerCM *corev1.ConfigMap, secrets []corev1.Secret) (*corev1.ConfigMap, error) {
	chains := chainsFromSecrets(secrets)
	yaml, err := renderEnvoyBootstrap(extAuthzInstanceID, cfg, chains)
	if err != nil {
		return nil, err
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      EnvoyBootstrapName(instanceName),
			Namespace: cfg.Namespace,
			Labels:    map[string]string{LabelAgent: instanceName},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Data: map[string]string{"envoy.yaml": yaml},
	}, nil
}

// envoyVolumes returns the pod-level volumes that back the gateway pod's
// bootstrap ConfigMap, per-Secret credential files, and the cert-manager-issued
// TLS leaf used to terminate the agent's intercepted TLS. None of these are
// referenced from the agent pod — the credential boundary lives at the pod
// boundary (ADR-038).
func envoyVolumes(instanceName string, secrets []corev1.Secret) []corev1.Volume {
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
	// Leaf cert is required whenever ANY route exists (allow-only or
	// credentialed) — both flavors terminate TLS to gate the request.
	if len(secrets) > 0 {
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
const envoyBootstrapTemplateRev = "v10-url-encode-cred"

// envoySecretsRev digests the Secret set that drives Envoy's chain
// rendering. Includes `injection-hosts` JSON so a descriptor change
// (host added / removed / retargeted on a connection) rolls the gateway —
// Envoy reads the bootstrap once at boot, so without a roll the chain
// shape goes stale.
func envoySecretsRev(secrets []corev1.Secret) string {
	parts := []string{"tmpl=" + envoyBootstrapTemplateRev}
	for _, s := range secrets {
		parts = append(parts, fmt.Sprintf("%s|%s|%s|%s|%s|%s",
			s.Name,
			s.Annotations[envoyHostPatternAnn],
			s.Labels[envoySecretTypeLabel],
			s.Annotations[envoyHeaderNameAnn],
			s.Annotations[envoyQueryParamAnn],
			s.Annotations[envoyInjectionHostsAnn],
		))
	}
	sort.Strings(parts[1:])
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(sum[:8])
}

// envoyContainer returns the gateway pod's Envoy container spec. Drops all caps,
// ReadOnlyRootFilesystem; mounts only the bootstrap CM and the owner's
// credential Secrets. Used as the sole non-init container of the paired
// gateway pod (ADR-038).
func envoyContainer(cfg *config.Config, secrets []corev1.Secret) corev1.Container {
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
	if len(secrets) > 0 {
		mounts = append(mounts, corev1.VolumeMount{
			Name:      envoyLeafTLSVolume,
			MountPath: envoyLeafTLSMount,
			ReadOnly:  true,
		})
	}
	readOnlyRoot := true
	runAsNonRoot := true
	return corev1.Container{
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
			ReadOnlyRootFilesystem: &readOnlyRoot,
			RunAsNonRoot:           &runAsNonRoot,
		},
	}
}
