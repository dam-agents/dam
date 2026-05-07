package reconciler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
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
	envoyHostPatternAnn   = "agent-platform.ai/host-pattern"
	envoyHeaderNameAnn    = "agent-platform.ai/injection-header-name"
	envoyAuthModeAnn      = "agent-platform.ai/auth-mode"
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

// envoyRoute is the per-Secret data the bootstrap template needs.
//
// `Credentialed=false` is the L7-promoted MITM-only flavor (ADR-035):
// the host has at least one path-specific egress_rule but no attached credential.
// We render TLS-terminating chain + ext_authz, but skip credential_injector and
// the credential SDS mount.
type envoyRoute struct {
	SecretName   string // K8s Secret name, used for the per-route credential file path
	Host         string // host the credential is scoped to (matched on :authority)
	HeaderName   string // header to inject (e.g. "Authorization")
	VolumeName   string // pod-level volume name for this Secret
	Credentialed bool   // true → render credential_injector; false → MITM-only chain
}

// envoySecretTypeAllowOnly marks Secrets that exist solely to extend the
// cert SAN list and force a host onto the L7 path so path-specific egress
// rules can be enforced. They carry no credential payload.
const envoySecretTypeAllowOnly = "allow-only"

// listAgentCredentialSecrets returns the owner's credential Secrets filtered
// by the per-agent grant annotations on the instance ConfigMap. See
// `filterByGrants` for the precise semantics.
func listAgentCredentialSecrets(ctx context.Context, client kubernetes.Interface, namespace, owner string, instanceCM *corev1.ConfigMap) ([]corev1.Secret, error) {
	all, err := listOwnerCredentialSecrets(ctx, client, namespace, owner)
	if err != nil {
		return nil, err
	}
	return filterByGrants(all, instanceCM.Annotations), nil
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

	out := secrets[:0:0]
	for _, s := range secrets {
		switch s.Labels[envoySecretTypeLabel] {
		case "connection":
			connKey := s.Labels[envoyConnectionLabel]
			if grantedConnIds[connKey] {
				out = append(out, s)
			}
		default:
			id := strings.TrimPrefix(s.Name, credentialSecretNamePrefix)
			if grantedSecretIds[id] {
				out = append(out, s)
			}
		}
	}
	return out
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

// credentialEnvVars synthesizes the env vars the agent harness needs to even
// *attempt* an upstream call when the corresponding credential Secret exists.
// Envoy's credential_injector overrides the header on the wire, but harnesses
// like Claude Code refuse to dispatch when the canonical env is unset, so the
// in-pod env has to carry a placeholder.
//
// The placeholder value is opaque to the upstream — Envoy overwrites it — so
// any non-empty string works. We use a stable `dummy-placeholder` token so
// logs stay grep-friendly.
func credentialEnvVars(secrets []corev1.Secret) []corev1.EnvVar {
	const sentinel = "dummy-placeholder"
	seen := map[string]struct{}{}
	add := func(envs []corev1.EnvVar, name string) []corev1.EnvVar {
		if _, dup := seen[name]; dup {
			return envs
		}
		seen[name] = struct{}{}
		return append(envs, corev1.EnvVar{Name: name, Value: sentinel})
	}
	var envs []corev1.EnvVar
	for _, s := range secrets {
		switch s.Labels[envoySecretTypeLabel] {
		case "anthropic":
			if s.Annotations[envoyAuthModeAnn] == "api-key" {
				envs = add(envs, "ANTHROPIC_API_KEY")
			} else {
				envs = add(envs, "CLAUDE_CODE_OAUTH_TOKEN")
			}
		case "connection":
			host := s.Annotations[envoyHostPatternAnn]
			if host == "github.com" || host == "api.github.com" {
				envs = add(envs, "GH_TOKEN")
			}
		}
	}
	return envs
}

// hasGitHubCredential reports whether any of the owner's K8s credential
// Secrets target a GitHub host. Used by the reconciler to warn when an
// instance has no GitHub credential so gh/octokit don't lose auth silently.
func hasGitHubCredential(secrets []corev1.Secret) bool {
	for _, s := range secrets {
		host := s.Annotations[envoyHostPatternAnn]
		if host == "github.com" || host == "api.github.com" {
			return true
		}
	}
	return false
}

func routesFromSecrets(secrets []corev1.Secret) []envoyRoute {
	routes := make([]envoyRoute, 0, len(secrets))
	for _, s := range secrets {
		host := s.Annotations[envoyHostPatternAnn]
		if host == "" {
			continue
		}
		header := s.Annotations[envoyHeaderNameAnn]
		if header == "" {
			header = "Authorization"
		}
		// Default credentialed for back-compat with Secrets predating the
		// secret-type label. Allow-only Secrets carry no credential payload
		// and exist purely to extend the cert SAN list.
		credentialed := s.Labels[envoySecretTypeLabel] != envoySecretTypeAllowOnly
		routes = append(routes, envoyRoute{
			SecretName:   s.Name,
			Host:         host,
			HeaderName:   header,
			VolumeName:   "cred-" + s.Name,
			Credentialed: credentialed,
		})
	}
	return routes
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
                        initial_metadata:
                          - { key: x-platform-instance, value: "{{ $.InstanceID }}" }
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
                        # Strip any client-supplied x-platform-instance
                        # first, then re-add the trusted value — the
                        # api-server identifies the caller from this
                        # header and the agent must not be able to
                        # forge it. ext_authz is disabled here: this is
                        # control-plane traffic to the api-server, not
                        # user egress, so HITL rules do not apply.
                        - match:
                            prefix: "/"
                            headers:
                              - name: ":authority"
                                string_match:
                                  exact: "{{ $.HarnessAuthority }}"
                          route:
                            cluster: dynamic_forward_proxy_http
                            timeout: 0s
                          request_headers_to_remove:
                            - x-platform-instance
                          request_headers_to_add:
                            - header:
                                key: x-platform-instance
                                value: "{{ $.InstanceID }}"
                              append_action: OVERWRITE_IF_EXISTS_OR_ADD
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
{{- range .Routes }}
        - name: terminate_{{ .SecretName }}
          filter_chain_match:
            server_names: [ "{{ .Host }}" ]
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
                stat_prefix: terminate_{{ .SecretName }}
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
                        initial_metadata:
                          - { key: x-platform-instance, value: "{{ $.InstanceID }}" }
                        timeout: {{ $.ExtAuthzTimeoutSeconds }}s
{{- if .Credentialed }}
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
                                path: {{ $.CredentialsRoot }}/{{ .VolumeName }}/{{ $.CredentialFile }}
                          header: "{{ .HeaderName }}"
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
                  name: forward_{{ .SecretName }}
                  virtual_hosts:
                    - name: default
                      domains: [ "*" ]
                      routes:
                        - match: { prefix: "/" }
                          route:
{{- if .Credentialed }}
                            # Pinned to a per-credential static cluster
                            # (clusters list below). The agent's Host header
                            # cannot steer this request to a different
                            # upstream; the cluster's destination is fixed in
                            # config. host_rewrite_literal additionally
                            # canonicalises the upstream Host so honest
                            # backends never see an agent-manipulated value.
                            cluster: upstream_{{ .SecretName }}
                            host_rewrite_literal: "{{ .Host }}"
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
                  initial_metadata:
                    - { key: x-platform-instance, value: "{{ $.InstanceID }}" }
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

{{- range .Routes }}
{{- if .Credentialed }}

    # Pinned upstream for the credentialed chain matching SNI={{ .Host }}.
    # STRICT_DNS resolves {{ .Host }}:443 directly; the agent's Host header
    # plays no role in destination selection. Upstream TLS hard-binds SNI
    # and validates the upstream cert's SAN against {{ .Host }}, so even a
    # poisoned cache or misrouted endpoint fails the handshake before any
    # credentialed body is on the wire.
    - name: upstream_{{ .SecretName }}
      connect_timeout: 5s
      type: STRICT_DNS
      lb_policy: ROUND_ROBIN
      load_assignment:
        cluster_name: upstream_{{ .SecretName }}
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: {{ .Host }}
                      port_value: 443
      transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
          sni: {{ .Host }}
          auto_host_sni: false
          common_tls_context:
            validation_context:
              trusted_ca:
                filename: /etc/ssl/certs/ca-certificates.crt
              match_typed_subject_alt_names:
                - san_type: DNS
                  matcher:
                    exact: {{ .Host }}
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
func renderEnvoyBootstrap(instanceName string, cfg *config.Config, routes []envoyRoute) (string, error) {
	tmpl, err := template.New("envoy").Parse(envoyBootstrapTmpl)
	if err != nil {
		return "", err
	}
	// Envoy's per-call timeout sits ahead of the application-level hold so a
	// hold-window timeout fires from the api-server side, not from Envoy.
	extAuthzTimeoutSeconds := cfg.ExtAuthzHoldSeconds + 60
	// :authority value the api-server harness port is reached on. The agent
	// builds harness URLs from cfg.HarnessServerURL, so the Host/:authority
	// includes the port. We match on this exact string so the trusted-header
	// route is scoped to api-server traffic only.
	harnessAuthority := fmt.Sprintf("%s:%d", cfg.APIServerHost, cfg.HarnessServerPort)
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, struct {
		ListenAddress          string
		Port                   int
		Routes                 []envoyRoute
		CredentialsRoot        string
		CredentialFile         string
		CredentialSDSName      string
		LeafTLSDir             string
		InstanceID             string
		HarnessAuthority       string
		ExtAuthzHost           string
		ExtAuthzPort           int
		ExtAuthzHoldSeconds    int
		ExtAuthzTimeoutSeconds int
	}{
		ListenAddress:          envoyListenAddress,
		Port:                   cfg.EnvoyPort,
		Routes:                 routes,
		CredentialsRoot:        envoyCredentialsRoot,
		CredentialFile:         envoyCredentialKeySDS,
		CredentialSDSName:      envoyCredentialSDSName,
		LeafTLSDir:             envoyLeafTLSMount,
		InstanceID:             instanceName,
		HarnessAuthority:       harnessAuthority,
		ExtAuthzHost:           cfg.ExtAuthzHost,
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
func BuildEnvoyBootstrapConfigMap(instanceName string, cfg *config.Config, ownerCM *corev1.ConfigMap, secrets []corev1.Secret) (*corev1.ConfigMap, error) {
	routes := routesFromSecrets(secrets)
	yaml, err := renderEnvoyBootstrap(instanceName, cfg, routes)
	if err != nil {
		return nil, err
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      EnvoyBootstrapName(instanceName),
			Namespace: cfg.Namespace,
			Labels:    map[string]string{"agent-platform.ai/instance": instanceName},
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
const envoyBootstrapTemplateRev = "v4-harness-trusted-header"

// envoySecretsRev is a stable digest of the Secret set that drives Envoy's
// chain rendering: secret name + host + secret-type label + headerName,
// plus a template-revision marker. Stamped on the pod template so the
// StatefulSet rolls when any of those change (new credentialed connection,
// allow-only Secret added, host retargeted, template format bumped). Sort
// first so reconcile order doesn't churn the hash.
func envoySecretsRev(secrets []corev1.Secret) string {
	parts := []string{"tmpl=" + envoyBootstrapTemplateRev}
	for _, s := range secrets {
		parts = append(parts, fmt.Sprintf("%s|%s|%s|%s",
			s.Name,
			s.Annotations[envoyHostPatternAnn],
			s.Labels[envoySecretTypeLabel],
			s.Annotations[envoyHeaderNameAnn],
		))
	}
	// Keep the template marker first; sort the rest so reconcile order
	// doesn't churn the hash.
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
