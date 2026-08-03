package reconciler

import (
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
	// Allow-only Secrets: the single host they promote to L7. The
	// header/query annotations are read only by the `envoySecretsRev`
	// digest these days.
	envoyHostPatternAnn = "agent-platform.ai/host-pattern"
	envoyHeaderNameAnn  = "agent-platform.ai/injection-header-name"
	envoyQueryParamAnn  = "agent-platform.ai/injection-query-param"
	// Opt-in HTTP/2 chain so credential injection covers a gRPC stream (Modal).
	envoyInjectionHTTP2Ann = "agent-platform.ai/injection-http2"
	// Connection Secrets: N injection targets as JSON. Issue #219. (The
	// api-server also stamps `agent-platform.ai/host-patterns` for kubectl
	// readability; the controller doesn't read it.)
	envoyInjectionHostsAnn = "agent-platform.ai/injection-hosts"
	// JSON-encoded list of {envName, placeholder} the api-server stamps on a
	// connection Secret. Authoritative source for the env vars the agent
	// harness needs as placeholders.
	envoyEnvMappingsAnn        = "agent-platform.ai/env-mappings"
	credentialSecretNamePrefix = "platform-cred-"
	envoyBootstrapVolume       = "envoy-bootstrap"
	envoyBootstrapMount        = "/etc/envoy"
	envoyCredentialsRoot       = "/etc/envoy/credentials"
	envoyCredentialKeySDS      = "sds.yaml"   // legacy single-host SDS data key; only matched by sdsDataKeys for the envoySecretsRev digest
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
	// SDS file key inside the Secret's volume — the api-server's `sdsKey`
	// (host-<base64url>.sds.yaml) — so one Secret carries N chains'
	// credentials (issue #219).
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
	// chain has at least one credential. Pinned to `Host:UpstreamPort`
	// with SAN-bound TLS validation so the agent's Host header cannot
	// redirect the credentialed body to an attacker-controlled upstream.
	UpstreamCluster string
	HTTP2           bool
	UpstreamPort    int // 0 → 443
	Upgrades        bool
	// Path to a CA bundle inside the gateway pod; empty → system bundle.
	UpstreamCAFile string
}

func (c envoyHostChain) UpstreamPortValue() int {
	if c.UpstreamPort == 0 {
		return 443
	}
	return c.UpstreamPort
}

// Authority presented upstream: bare host on 443, host:port otherwise.
func (c envoyHostChain) HostRewrite() string {
	if p := c.UpstreamPortValue(); p != 443 {
		return fmt.Sprintf("%s:%d", c.Host, p)
	}
	return c.Host
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
//   - Allow-only secrets (`agent-platform.ai/secret-type` = allow-only) pass
//     through ungated: they carry no credential — they exist to promote a
//     host onto the L7 chain so path-scoped egress rules are enforceable
//     over HTTPS. Grants gate credential access, not rule enforcement;
//     filtering these out silently voids the owner's rules (#2322).
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
		case envoySecretTypeAllowOnly:
			out = append(out, s)
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
// wire). Source of truth: every connection Secret stamps
// `envoyEnvMappingsAnn` (from `flow.envMappings`) with the env it
// contributes. Secrets are pre-sorted by Name in
// `listOwnerCredentialSecrets`, so dedup is "first-granted wins" on
// env-name collisions.
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
		raw := s.Annotations[envoyEnvMappingsAnn]
		if raw == "" {
			continue
		}
		var mappings []envMapping
		if err := json.Unmarshal([]byte(raw), &mappings); err != nil {
			slog.Warn("invalid env-mappings annotation; skipping",
				"namespace", s.Namespace, "secret", s.Name, "error", err)
			continue
		}
		for _, m := range mappings {
			envs = add(envs, m.EnvName, m.Placeholder)
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
	Port           int    `json:"port,omitempty"` // 0 → 443
	Upgrades       bool   `json:"upgrades,omitempty"`
	CAKey          string `json:"caKey,omitempty"` // Secret field holding the upstream CA bundle
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
	host string
	opts chainOpts
	cred envoyCredential
}

// Chain-level attributes beyond the credential. Merged across a host's
// entries: bools OR, port/CA first-wins.
type chainOpts struct {
	http2    bool
	port     int
	upgrades bool
	caFile   string
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
		caFile := ""
		if e.CAKey != "" {
			switch {
			// A separator would escape the Secret mount; a missing data key
			// would make Envoy fail to boot. Both degrade to system trust
			// (fail-closed for a private CA) rather than crash the gateway.
			case strings.ContainsAny(e.CAKey, "/\\") || strings.Contains(e.CAKey, ".."):
				slog.Warn("invalid caKey in injection-hosts; ignoring",
					"namespace", s.Namespace, "secret", s.Name, "host", e.Host, "caKey", e.CAKey)
			case len(s.Data[e.CAKey]) == 0:
				slog.Warn("connection Secret missing CA data key; validating host against system trust instead",
					"namespace", s.Namespace, "secret", s.Name, "host", e.Host, "caKey", e.CAKey)
			default:
				caFile = envoyCredentialsRoot + "/cred-" + s.Name + "/" + e.CAKey
			}
		}
		out = append(out, hostCredential{
			host: e.Host,
			opts: chainOpts{
				http2:    e.HTTP2,
				port:     e.Port,
				upgrades: e.Upgrades,
				caFile:   caFile,
			},
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
// JSON (issue #219); allow-only Secrets contribute their single
// `host-pattern` host with no credential; any other non-connection
// Secret contributes nothing. Within a chain, duplicate header names are
// dropped (credential_injector overwrite: true would silently clobber)
// with a warning.
//
// Allow-only-only host → uncredentialed chain (MITM gate + dynamic_forward
// _proxy). Mixed → credentialed chain; allow-only contributes nothing.
//
// `l7Hosts` is the Agent spec's per-agent L7 promotion list (#2865):
// each entry gets an uncredentialed chain exactly like an allow-only
// Secret. The Secret-shaped allow-only flavor remains consumed for
// migration (pre-gen-5 markers) and as the missing-SDS degrade target.
func chainsFromSecrets(secrets []corev1.Secret, l7Hosts []string) []envoyHostChain {
	type bucket struct {
		host        string
		seenHeader  map[string]string
		credentials []envoyCredential
		opts        chainOpts
		first       string // first Secret name encountered for this host (drives ChainID)
	}
	byHost := map[string]*bucket{}
	order := []string{}

	add := func(host, secretName string, cred *envoyCredential, opts chainOpts) {
		if host == "" {
			return
		}
		b := byHost[host]
		if b == nil {
			b = &bucket{host: host, seenHeader: map[string]string{}, first: secretName}
			byHost[host] = b
			order = append(order, host)
		}
		if opts.http2 {
			b.opts.http2 = true
		}
		if opts.upgrades {
			b.opts.upgrades = true
		}
		// The chain has one upstream socket and one validation context, so
		// port/CA can't stack the way credentials do: first entry wins.
		if opts.port != 0 {
			if b.opts.port == 0 {
				b.opts.port = opts.port
			} else if b.opts.port != opts.port {
				slog.Warn("conflicting upstream ports on host; keeping first",
					"host", host, "keptPort", b.opts.port,
					"skippedPort", opts.port, "skippedSecret", secretName)
			}
		}
		if opts.caFile != "" {
			if b.opts.caFile == "" {
				b.opts.caFile = opts.caFile
			} else if b.opts.caFile != opts.caFile {
				slog.Warn("conflicting upstream CA files on host; keeping first",
					"host", host, "keptCA", b.opts.caFile,
					"skippedCA", opts.caFile, "skippedSecret", secretName)
			}
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
					add(hc.host, s.Name, nil, hc.opts)
					continue
				}
				add(hc.host, s.Name, &cred, hc.opts)
			}
		case envoySecretTypeAllowOnly:
			// Registers the host (extends the leaf cert SAN list, forces
			// L7 termination) but contributes no credential.
			add(s.Annotations[envoyHostPatternAnn], s.Name, nil,
				chainOpts{http2: s.Annotations[envoyInjectionHTTP2Ann] == "true"})
		}
	}

	// Per-agent promoted hosts (spec.l7Hosts) — uncredentialed chains. The
	// synthetic "l7" name only seeds ChainID/UpstreamCluster naming for
	// hosts no Secret already claimed; `add` dedupes against credentialed
	// and allow-only chains by host.
	for _, host := range l7Hosts {
		add(host, "l7", nil, chainOpts{})
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
			HTTP2:           b.opts.http2,
			UpstreamPort:    b.opts.port,
			Upgrades:        b.opts.upgrades,
			UpstreamCAFile:  b.opts.caFile,
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

// Gateway liveness path the health_check filter answers locally before
// ext_authz, so the np-gate probe doesn't trip the egress gate (#675).
//
// The bootstrap document itself is assembled as structured data and serialized
// by a real YAML encoder in envoy_bootstrap.go (#2899) — see buildEnvoyBootstrap
// for the topology and the credential-injection wiring that used to live in a
// string template here.
const platformGatewayHealthPath = "/__platform_healthz"

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
// injected). `instanceName` is the gateway's own identity (the agent
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

// BuildEnvoyBootstrapConfigMap is the desired ConfigMap holding the rendered
// Envoy bootstrap YAML for an instance.
//
// `attributionID` overrides the trusted `x-platform-agent-id` telemetry stamp:
// empty means stamp `instanceName` (the default — the gateway attributes to its
// own instance); non-empty means stamp that id instead and additionally stamp
// `x-platform-invocation-id` with `instanceName`. The api-server sets it for
// Invocation targets to their root Driver (#3041).
func BuildEnvoyBootstrapConfigMap(instanceName, attributionID string, cfg *config.Config, ownerRef metav1.OwnerReference, secrets []corev1.Secret, l7Hosts []string) (*corev1.ConfigMap, error) {
	chains := chainsFromSecrets(secrets, l7Hosts)
	yaml, err := renderEnvoyBootstrap(instanceName, attributionID, cfg, chains)
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
func envoyVolumes(instanceName string, cfg *config.Config, secrets []corev1.Secret, l7Hosts []string) []corev1.Volume {
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
	// allow-only / promoted / credentialed chains (all gate the request),
	// or the telemetry collector chain (it MITM-terminates the collector
	// SNI even when the instance has no credential Secrets).
	if len(secrets) > 0 || len(l7Hosts) > 0 || cfg.TelemetryEnabled() {
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
const envoyBootstrapTemplateRev = "v15-structured-config"

// envoySecretsRev digests the Secret set that drives Envoy's chain
// rendering. Includes `injection-hosts` JSON so a descriptor change
// (host added / removed / retargeted on a connection) rolls the gateway —
// Envoy reads the bootstrap once at boot, so without a roll the chain
// shape goes stale. The SDS data-key set is included too: chain rendering
// degrades a host to allow-only when its SDS key is missing, so a Secret
// gaining (or losing) an SDS key changes the chain shape and must roll.
// `l7Hosts` (the Agent spec's per-agent promotion list, #2865) shapes
// chains the same way, so it is digested too — order-insensitively,
// like the Secret parts.
func envoySecretsRev(secrets []corev1.Secret, l7Hosts []string) string {
	parts := []string{"tmpl=" + envoyBootstrapTemplateRev}
	for _, h := range l7Hosts {
		parts = append(parts, "l7|"+h)
	}
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
func envoyContainer(instanceName string, cfg *config.Config, secrets []corev1.Secret, l7Hosts []string) corev1.Container {
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
	if len(secrets) > 0 || len(l7Hosts) > 0 || cfg.TelemetryEnabled() {
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
