package reconciler

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func ownerSecret(name, secretType, connection string) corev1.Secret {
	labels := map[string]string{
		envoyOwnerLabel:      "owner-1",
		envoyManagedByLabel:  "api-server",
		envoySecretTypeLabel: secretType,
	}
	if connection != "" {
		labels[envoyConnectionLabel] = connection
	}
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        name,
			Annotations: map[string]string{envoyHostPatternAnn: "api.example.com"},
			Labels:      labels,
		},
		// Healthy Secrets carry the SDS file the bootstrap references;
		// chain rendering degrades to allow-only without it. Connection
		// fixtures add their per-host keys via withHostSDS.
		Data: map[string][]byte{envoyCredentialKeySDS: []byte("resources: []")},
	}
}

// withHostSDS stamps the per-host SDS data keys a connection Secret's
// injection-hosts entries reference (api-server naming, no sdsKey override).
func withHostSDS(s corev1.Secret, hosts ...string) corev1.Secret {
	if s.Data == nil {
		s.Data = map[string][]byte{}
	}
	for _, h := range hosts {
		s.Data[sdsFileKeyForHost(h)] = []byte("resources: []")
	}
	return s
}

func names(in []corev1.Secret) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		out = append(out, s.Name)
	}
	return out
}

func TestFilterByGrants_AbsentAnnotationsGrantNothing(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-cred-bbb", "generic", ""),
		ownerSecret("platform-conn-github", "connection", "github"),
	}
	// Always-selective: empty/absent grants grant nothing.
	got := filterByGrants(secrets, nil, nil)
	assert.Empty(t, got)
}

func TestFilterByGrants_SelectiveSecretsDropUngranted(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-cred-bbb", "generic", ""),
	}
	got := filterByGrants(secrets, []string{"aaa"}, nil)
	assert.Equal(t, []string{"platform-cred-aaa"}, names(got))
}

func TestFilterByGrants_EmptySecretListGrantsNothing(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-cred-bbb", "generic", ""),
	}
	got := filterByGrants(secrets, []string{}, nil)
	assert.Empty(t, got)
}

func TestFilterByGrants_ConnectionGrantsByList(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-conn-github", "connection", "github"),
		ownerSecret("platform-conn-slack", "connection", "slack"),
	}
	got := filterByGrants(secrets, nil, []string{"github"})
	assert.Equal(t, []string{"platform-conn-github"}, names(got))

	// Empty list → nothing granted.
	got = filterByGrants(secrets, nil, []string{})
	assert.Empty(t, got)
}

func TestFilterByGrants_SecretAndConnectionAxesAreIndependent(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-cred-bbb", "generic", ""),
		ownerSecret("platform-conn-github", "connection", "github"),
		ownerSecret("platform-conn-slack", "connection", "slack"),
	}
	got := filterByGrants(secrets, []string{"aaa"}, []string{"slack"})
	assert.ElementsMatch(t, []string{"platform-cred-aaa", "platform-conn-slack"}, names(got))
}

// --- Bootstrap render tests ---
//
// These cover the security-critical shape of the rendered Envoy config:
// credentialed chains forward to a per-credential static cluster pinned to
// the credential's host with SAN-bound upstream TLS validation; the agent's
// inner Host header has no influence on routing. The route-confusion
// exfiltration path in the threat model is structurally
// closed by these properties — the assertions below are the regression spec.

// ExtAuthzHost is no longer a flat config field — it is computed
// per-instance via cfg.ExtAuthzHostFor(<id>) using ReleaseName + ReleaseNamespace.
var bootstrapTestCfg = &config.Config{
	Namespace:           "agents",
	ReleaseName:         "platform",
	ReleaseNamespace:    "platform",
	HarnessServerPort:   4001,
	EnvoyPort:           10000,
	ExtAuthzPort:        50051,
	ExtAuthzHoldSeconds: 30,
}

func credentialedChain(secretName, host string) envoyHostChain {
	return envoyHostChain{
		ChainID:         "chain_" + secretName,
		UpstreamCluster: "upstream_" + secretName,
		Host:            host,
		Credentials: []envoyCredential{{
			SecretName: secretName,
			HeaderName: "Authorization",
			VolumeName: "cred-" + secretName,
			SDSFileKey: envoyCredentialKeySDS,
		}},
	}
}

func allowOnlyChain(secretName, host string) envoyHostChain {
	return envoyHostChain{
		ChainID:         "chain_" + secretName,
		UpstreamCluster: "upstream_" + secretName,
		Host:            host,
		// Empty Credentials → Credentialed() == false.
	}
}

func queryParamChain(secretName, host, headerName, queryParamName string) envoyHostChain {
	return envoyHostChain{
		ChainID:         "chain_" + secretName,
		UpstreamCluster: "upstream_" + secretName,
		Host:            host,
		Credentials: []envoyCredential{{
			SecretName:     secretName,
			HeaderName:     headerName,
			QueryParamName: queryParamName,
			VolumeName:     "cred-" + secretName,
			SDSFileKey:     envoyCredentialKeySDS,
		}},
	}
}

// twoCredentialChain expresses the "two injections on the same host"
// shape — a header-only credential + a query-only credential targeting
// the same SNI. Used to assert merge semantics in chainsFromSecrets
// produce a single filter chain with two credential_injector + one Lua.
func twoCredentialChain(firstName, secondName, host string) envoyHostChain {
	return envoyHostChain{
		ChainID:         "chain_" + firstName,
		UpstreamCluster: "upstream_" + firstName,
		Host:            host,
		Credentials: []envoyCredential{
			{
				SecretName: firstName,
				HeaderName: "Authorization",
				VolumeName: "cred-" + firstName,
				SDSFileKey: envoyCredentialKeySDS,
			},
			{
				SecretName:     secondName,
				HeaderName:     "X-Internal-Query-" + secondName,
				QueryParamName: "key",
				SDSFileKey:     envoyCredentialKeySDS,
				VolumeName:     "cred-" + secondName,
			},
		},
	}
}

func TestRenderEnvoyBootstrap_CredentialedRoutePinnedToStaticCluster(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)

	// Per-credential cluster exists, with the credential's host as its only
	// endpoint. STRICT_DNS so Envoy resolves at refresh cadence; no
	// dynamic_forward_proxy means the agent's Host header cannot redirect
	// the request elsewhere.
	assert.Contains(t, got, "name: upstream_platform-conn-github")
	assert.Contains(t, got, "type: STRICT_DNS")
	assert.Contains(t, got, "address: api.github.com")
	assert.Contains(t, got, "port_value: 443")

	// STRICT_DNS defaults to AUTO (IPv6-first); pods on IPv4-only egress
	// would otherwise see "Network is unreachable" against the resolved
	// AAAA. Match the explicit V4_PREFERRED used by every other DNS
	// cluster in the bootstrap.
	assert.Contains(t, got, "dns_lookup_family: V4_PREFERRED")

	// Upstream TLS hard-binds SNI to the credential's host and SAN-validates
	// the upstream cert against it. Even a poisoned DNS cache or misrouted
	// cluster fails the upstream handshake before the credentialed body
	// reaches the wire.
	assert.Contains(t, got, "sni: api.github.com")
	assert.Contains(t, got, "match_typed_subject_alt_names")
	assert.Regexp(t, `match_typed_subject_alt_names:\s*\n\s*-\s*san_type:\s*DNS\s*\n\s*matcher:\s*\n\s*exact:\s*api\.github\.com`, got)

	// The credentialed chain forwards to that cluster — not to
	// dynamic_forward_proxy_https (which uses agent-controlled Host).
	assert.Contains(t, got, "cluster: upstream_platform-conn-github")
	assert.Contains(t, got, `host_rewrite_literal: "api.github.com"`)
}

func TestRenderEnvoyBootstrap_EmptyRoutesNoLeafTLSReferences(t *testing.T) {
	// Reconcile race: when an agent is created and the secret is granted in
	// two API calls, the controller renders a rev-1 StatefulSet with empty
	// secrets (no leaf-TLS volume mounted) before rev-2 picks up the grant.
	// The bootstrap CM is named by instance, not by revision — so a pod
	// from rev-1's spec that survives into rev-2 will read a CM whose
	// content may have shifted. The bootstrap MUST NOT reference any
	// `/etc/envoy/tls/*` paths when there are no credentialed routes,
	// otherwise a no-grants render would crash with "Failed to load
	// incomplete private key" the moment the CM is updated to include
	// routes (the volume backing that path doesn't exist yet).
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, nil)
	require.NoError(t, err)
	assert.NotContains(t, got, "tls.key",
		"empty-routes bootstrap must not reference the leaf TLS private key — pod has no envoy-tls volume to back it")
	assert.NotContains(t, got, "tls.crt",
		"empty-routes bootstrap must not reference the leaf TLS cert chain — pod has no envoy-tls volume to back it")
	// The L4 SNI-miss catch-all chain is still present so the pod boots
	// to a useful state and starts gating egress as soon as the chain set
	// updates; without this, an empty-routes pod would be a noop.
	assert.Contains(t, got, "l4_authz_passthrough")
}

func TestRenderEnvoyBootstrap_NoCredentialedRouteForwardsViaDynamicForwardProxy(t *testing.T) {
	// With no credentialed routes there should be no per-credential cluster
	// and no host_rewrite_literal — the catch-all/L4 paths still use
	// dynamic_forward_proxy clusters but those are non-credentialed.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		allowOnlyChain("platform-allow-only-npm", "registry.npmjs.org"),
	})
	require.NoError(t, err)

	// Allow-only chain still uses dynamic_forward_proxy_https — there's no
	// credential to misroute, so the simpler shape is fine.
	assert.NotContains(t, got, "upstream_platform-allow-only-npm")
	assert.NotContains(t, got, "host_rewrite_literal")
	assert.Contains(t, got, "cluster: dynamic_forward_proxy_https")
}

func TestRenderEnvoyBootstrap_MixedRoutesOnlyPinCredentialed(t *testing.T) {
	// Credentialed and allow-only side-by-side: only the credentialed one
	// gets a pinned cluster. The two chains are visually adjacent in the
	// output, so we anchor each assertion on its specific cluster name.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
		allowOnlyChain("platform-allow-only-npm", "registry.npmjs.org"),
	})
	require.NoError(t, err)

	// `- name: upstream_…` is the cluster definition (list-entry dash);
	// `cluster_name: upstream_…` inside each definition is a field, not a
	// new cluster, so count only the definitions.
	pinnedCount := strings.Count(got, "- name: upstream_")
	assert.Equal(t, 1, pinnedCount, "exactly one pinned upstream cluster should be rendered (credentialed routes only)")
	assert.Contains(t, got, "name: upstream_platform-conn-github")
	assert.NotContains(t, got, "name: upstream_platform-allow-only-npm")
}

// telemetryTestCfg copies bootstrapTestCfg with the telemetry collector
// configured, so the gateway renders the collector egress chain.
func telemetryTestCfg() *config.Config {
	c := *bootstrapTestCfg
	c.TelemetryCollectorHost = "platform-clickstack-collector.platform.svc.cluster.local"
	c.TelemetryCollectorPort = 4318
	return &c
}

func TestRenderEnvoyBootstrap_TelemetryStampsTrustedAgentID(t *testing.T) {
	// Telemetry on, no credential Secrets — the collector chain stands alone.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", telemetryTestCfg(), nil)
	require.NoError(t, err)

	// Dedicated collector chain, matched on the collector SNI.
	assert.Contains(t, got, "terminate_otel_collector")
	assert.Contains(t, got, `server_names: [ "platform-clickstack-collector.platform.svc.cluster.local" ]`)

	// Trusted identity header stamped with OVERWRITE so an agent-supplied
	// value can't survive; value is this instance's id.
	assert.Contains(t, got, "key: x-platform-agent-id")
	assert.Contains(t, got, `value: "inst-1"`)
	assert.Contains(t, got, "OVERWRITE_IF_EXISTS_OR_ADD")

	// Pinned STRICT_DNS collector cluster on the OTLP/HTTP port.
	assert.Contains(t, got, "address: platform-clickstack-collector.platform.svc.cluster.local")
	assert.Contains(t, got, "port_value: 4318")

	// The collector chain is platform-internal: no HITL ext_authz and no
	// credential injection on it. Isolate the chain (it precedes the L4
	// catch-all) so the assertion doesn't trip on ext_authz elsewhere.
	cs := strings.Index(got, "- name: terminate_otel_collector")
	ce := strings.Index(got, "# SNI miss")
	require.True(t, cs >= 0 && ce > cs, "collector chain must precede the L4 catch-all")
	collectorChain := got[cs:ce]
	assert.NotContains(t, collectorChain, "ext_authz")
	assert.NotContains(t, collectorChain, "credential_injector")

	// The collector upstream is plaintext (ztunnel adds mTLS on the in-cluster
	// hop) — no upstream TLS transport_socket on the cluster definition.
	clusterDef := got[strings.Index(got, "- name: otel_collector"):]
	clusterDef = clusterDef[:strings.Index(clusterDef[len("- name: otel_collector"):], "- name: ")+len("- name: otel_collector")]
	assert.Contains(t, clusterDef, "type: STRICT_DNS")
	assert.NotContains(t, clusterDef, "transport_socket")
}

func TestRenderEnvoyBootstrap_TelemetryRendersValidYAML(t *testing.T) {
	// The bootstrap is a templated YAML string embedded in a ConfigMap, so a
	// stray indent in the collector chain/cluster only surfaces when Envoy
	// boots. Render with telemetry on AND a credentialed chain (both new
	// template blocks plus the existing ones active) and confirm the whole
	// document parses as YAML.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", telemetryTestCfg(), []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	var doc map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(got), &doc), "rendered bootstrap must be valid YAML")
	// The collector chain/cluster coexist with the credentialed chain (distinct
	// hosts → no collision).
	assert.Contains(t, got, "terminate_otel_collector")
	assert.Contains(t, got, "- name: otel_collector")
	assert.Contains(t, got, "name: upstream_platform-conn-github")
}

func TestRenderEnvoyBootstrap_TelemetryDisabledNoCollectorChain(t *testing.T) {
	// bootstrapTestCfg has no collector host → telemetry off.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, nil)
	require.NoError(t, err)
	assert.NotContains(t, got, "terminate_otel_collector")
	assert.NotContains(t, got, "otel_collector")
	assert.NotContains(t, got, "x-platform-agent-id")
}

func TestRenderEnvoyBootstrap_TelemetryHeaderUsesInstanceNotExtAuthzID(t *testing.T) {
	// Forks dial the PARENT's ext-authz Service (extAuthzInstanceID=parent)
	// but their telemetry must attribute to the fork itself — the header value
	// tracks the instance id, not the ext-authz id.
	got, err := renderEnvoyBootstrap("fork-xyz", "parent-agent", telemetryTestCfg(), nil)
	require.NoError(t, err)
	assert.Contains(t, got, `value: "fork-xyz"`)
	assert.NotContains(t, got, `value: "parent-agent"`)
	// ext-authz authority still points at the parent's per-instance Service.
	assert.Contains(t, got, "extauthz-parent-agent")
}

func hasVolumeNamed(vols []corev1.Volume, name string) bool {
	for _, v := range vols {
		if v.Name == name {
			return true
		}
	}
	return false
}

func hasMountNamed(mounts []corev1.VolumeMount, name string) bool {
	for _, m := range mounts {
		if m.Name == name {
			return true
		}
	}
	return false
}

func TestEnvoyVolumes_TelemetryMountsLeafWithoutSecrets(t *testing.T) {
	// No credential Secrets, telemetry on: the leaf TLS volume + mount must
	// still be present because the collector chain MITM-terminates with it.
	// Without this the gateway would crash loading a non-existent tls.key.
	cfg := telemetryTestCfg()
	assert.True(t, hasVolumeNamed(envoyVolumes("inst-1", cfg, nil), envoyLeafTLSVolume),
		"leaf TLS volume must be present when telemetry is on even with no Secrets")
	assert.True(t, hasMountNamed(envoyContainer("inst-1", cfg, nil).VolumeMounts, envoyLeafTLSVolume),
		"leaf TLS mount must be present when telemetry is on even with no Secrets")
}

func TestEnvoyVolumes_NoLeafWhenNoSecretsNoTelemetry(t *testing.T) {
	assert.False(t, hasVolumeNamed(envoyVolumes("inst-1", bootstrapTestCfg, nil), envoyLeafTLSVolume))
	assert.False(t, hasMountNamed(envoyContainer("inst-1", bootstrapTestCfg, nil).VolumeMounts, envoyLeafTLSVolume))
}

func TestRenderEnvoyBootstrap_TelemetryHostCollisionSuppressesCollectorChain(t *testing.T) {
	// If the collector host collided with a credentialed chain host, two
	// filter chains would share server_names — fatal to Envoy. The collector
	// chain is suppressed; the credentialed chain wins (and the host stays in
	// the leaf SAN via that chain).
	cfg := telemetryTestCfg()
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", cfg, []envoyHostChain{
		credentialedChain("platform-conn-collector", cfg.TelemetryCollectorHost),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "terminate_otel_collector")
	assert.NotContains(t, got, "- name: otel_collector")
}

// secretWithEnvMappings returns an owner-labelled Secret carrying an
// `agent-platform.ai/env-mappings` annotation with the given mappings JSON-
// encoded. Caller may pass `rawJSON` directly to test malformed inputs.
func secretWithEnvMappings(name, secretType string, rawJSON string) corev1.Secret {
	s := ownerSecret(name, secretType, "")
	if s.Annotations == nil {
		s.Annotations = map[string]string{}
	}
	s.Annotations[envoyEnvMappingsAnn] = rawJSON
	return s
}

func envByName(envs []corev1.EnvVar) map[string]string {
	out := map[string]string{}
	for _, e := range envs {
		out[e.Name] = e.Value
	}
	return out
}

func TestCredentialEnvVars_ReadsEnvMappingsAnnotation(t *testing.T) {
	// The secret's `env-mappings` annotation is the source of truth
	// — controller emits exactly the listed envs with their placeholders.
	got := credentialEnvVars([]corev1.Secret{
		secretWithEnvMappings(
			"platform-cred-aaa",
			"generic",
			`[{"envName":"FOO","placeholder":"foo-sentinel"},{"envName":"BAR","placeholder":"bar-sentinel"}]`,
		),
	})
	envs := envByName(got)
	assert.Equal(t, "foo-sentinel", envs["FOO"])
	assert.Equal(t, "bar-sentinel", envs["BAR"])
	assert.Len(t, envs, 2)
}

func TestCredentialEnvVars_FirstSecretWinsOnEnvNameCollision(t *testing.T) {
	// Two granted secrets contributing the same env name. Owner secret list
	// is lex-sorted by Name (`listOwnerCredentialSecrets`), so the lex-
	// smallest one wins via the inner dedup.
	got := credentialEnvVars([]corev1.Secret{
		secretWithEnvMappings(
			"platform-cred-aaa",
			"generic",
			`[{"envName":"SHARED","placeholder":"first"}]`,
		),
		secretWithEnvMappings(
			"platform-cred-zzz",
			"generic",
			`[{"envName":"SHARED","placeholder":"second"}]`,
		),
	})
	envs := envByName(got)
	assert.Equal(t, "first", envs["SHARED"])
	assert.Len(t, envs, 1)
}

func TestCredentialEnvVars_MalformedJSONFallsBackToLegacySwitch(t *testing.T) {
	// Parse-tolerant fallback: malformed JSON should not hide the canonical
	// Anthropic env. Hand-edited Secrets and legacy fixtures rely on
	// this path.
	s := ownerSecret("platform-cred-aaa", "anthropic", "")
	s.Annotations[envoyAuthModeAnn] = "api-key"
	s.Annotations[envoyEnvMappingsAnn] = "{not-json}"
	got := credentialEnvVars([]corev1.Secret{s})
	envs := envByName(got)
	assert.Equal(t, "dummy-placeholder", envs["ANTHROPIC_API_KEY"])
}

func TestCredentialEnvVars_AnthropicFallsBackToLegacySwitch(t *testing.T) {
	// Anthropic Secret with no `env-mappings` annotation (e.g. created
	// via raw `kubectl apply`) — legacy switch fills in
	// `CLAUDE_CODE_OAUTH_TOKEN`.
	oauthSecret := ownerSecret("platform-cred-aaa", "anthropic", "")
	oauthSecret.Annotations[envoyAuthModeAnn] = "oauth"

	got := credentialEnvVars([]corev1.Secret{oauthSecret})
	envs := envByName(got)
	assert.Equal(t, "dummy-placeholder", envs["CLAUDE_CODE_OAUTH_TOKEN"])
}

func TestCredentialEnvVars_ConnectionEnvMappingsDeclareTheVars(t *testing.T) {
	// Connection env vars come from the api-server's `env-mappings`
	// annotation (declarative), not from a host-specific hardcode. A
	// github connection stamps GH_TOKEN; a GHE connection adds GH_HOST.
	gh := ownerSecret("platform-conn-github", "connection", "github")
	delete(gh.Annotations, envoyHostPatternAnn)
	gh.Annotations[envoyEnvMappingsAnn] = `[{"envName":"GH_TOKEN","placeholder":"dummy-placeholder"}]`

	ghe := ownerSecret("platform-conn-ghe", "connection", "github-enterprise")
	delete(ghe.Annotations, envoyHostPatternAnn)
	ghe.Annotations[envoyEnvMappingsAnn] =
		`[{"envName":"GH_TOKEN","placeholder":"dummy-placeholder"},` +
			`{"envName":"GH_HOST","placeholder":"ghe.example.com"}]`

	envs := envByName(credentialEnvVars([]corev1.Secret{gh, ghe}))
	assert.Equal(t, "dummy-placeholder", envs["GH_TOKEN"])
	// GHE-supplied GH_HOST persists — but GH_TOKEN dedup keeps the
	// first-granted value (which is the github connection here).
	assert.Equal(t, "ghe.example.com", envs["GH_HOST"])
}

func TestChainsFromSecrets_ConnectionSecretFansIntoNChains(t *testing.T) {
	// Issue #219: one github Secret → three chains, each reading a
	// per-host SDS file inside the same Secret volume.
	s := ownerSecret("platform-conn-github", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"},
		{"host":"raw.githubusercontent.com"}
	]`
	s = withHostSDS(s, "api.github.com", "github.com", "raw.githubusercontent.com")

	chains := chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 3)

	hosts := []string{chains[0].Host, chains[1].Host, chains[2].Host}
	assert.ElementsMatch(t,
		[]string{"api.github.com", "github.com", "raw.githubusercontent.com"},
		hosts,
	)

	// Same Secret volume per chain, distinct per-host SDS file. Keys
	// must agree with the api-server's `sdsFileKeyForHost`.
	for _, c := range chains {
		require.Len(t, c.Credentials, 1)
		cred := c.Credentials[0]
		assert.Equal(t, "cred-platform-conn-github", cred.VolumeName)
		assert.Equal(t, sdsFileKeyForHost(c.Host), cred.SDSFileKey)
		assert.NotEqual(t, envoyCredentialKeySDS, cred.SDSFileKey,
			"connection Secrets must use per-host SDS files, not the legacy sds.yaml key")
	}
}

func TestChainsFromSecrets_MultiHostSecretYieldsDistinctClusterNames(t *testing.T) {
	// Regression: one Secret with three hosts must produce three chains
	// with three DISTINCT UpstreamCluster / ChainID. Envoy refuses to
	// start with `duplicate cluster '…'` if two chains collide.
	s := ownerSecret("platform-conn-github", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"},
		{"host":"raw.githubusercontent.com"}
	]`
	s = withHostSDS(s, "api.github.com", "github.com", "raw.githubusercontent.com")

	chains := chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 3)

	clusters := map[string]bool{}
	chainIDs := map[string]bool{}
	for _, c := range chains {
		assert.False(t, clusters[c.UpstreamCluster],
			"duplicate UpstreamCluster %q would crash Envoy", c.UpstreamCluster)
		assert.False(t, chainIDs[c.ChainID],
			"duplicate ChainID %q would clash on listener names", c.ChainID)
		clusters[c.UpstreamCluster] = true
		chainIDs[c.ChainID] = true
	}
}

func TestChainsFromSecrets_ConnectionMissingSDSKeyDegradesToAllowOnly(t *testing.T) {
	// Regression for the fork-gateway boot crash: a stale pre-cutover
	// connection Secret carries an injection-hosts annotation without
	// sdsKey entries, and data keys under a naming scheme older than the
	// fallback computes (here the sha8-era `host-<hex8>.sds.yaml`). A
	// bootstrap referencing the missing base64url file is a fatal Envoy
	// config error that crash-loops the gateway — render the host
	// allow-only instead.
	s := ownerSecret("platform-conn-347e511ae0055405-64b2b6d12bfe4baa", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`
	s.Data = map[string][]byte{
		"access_token":           []byte("gho_abc"),
		"host-1a2b3c4d.sds.yaml": []byte("resources: []"),
	}

	chains := chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 1)
	assert.Equal(t, "api.github.com", chains[0].Host)
	assert.False(t, chains[0].Credentialed(),
		"missing SDS data key must degrade to allow-only, not render an unbootable bootstrap")
}

func TestChainsFromSecrets_ConnectionPartialSDSKeysDegradePerHost(t *testing.T) {
	// Only the host whose SDS file is missing degrades; the healthy host
	// keeps its credential.
	s := ownerSecret("platform-conn-github", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"}
	]`
	s = withHostSDS(s, "api.github.com")

	chains := chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 2)
	byHost := map[string]envoyHostChain{}
	for _, c := range chains {
		byHost[c.Host] = c
	}
	assert.True(t, byHost["api.github.com"].Credentialed())
	assert.False(t, byHost["github.com"].Credentialed())
}

func TestChainsFromSecrets_SingleHostSecretMissingSDSYamlDegradesToAllowOnly(t *testing.T) {
	// Same guard for the legacy single-host shape: no sds.yaml in data →
	// allow-only chain, never a bootstrap path Envoy can't open.
	s := ownerSecret("platform-cred-aaa", "generic", "")
	s.Annotations[envoyHeaderNameAnn] = "Authorization"
	s.Data = map[string][]byte{"value": []byte("Bearer abc")}

	chains := chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 1)
	assert.Equal(t, "api.example.com", chains[0].Host)
	assert.False(t, chains[0].Credentialed())
}

func TestSDSFileKeyForHost_StableAndShort(t *testing.T) {
	// Pinned against the api-server's `sdsFileKeyForHost`. Mismatch =
	// gateway reads a missing file.
	assert.Equal(t, "host-YXBpLmdpdGh1Yi5jb20.sds.yaml", sdsFileKeyForHost("api.github.com"))
	assert.Equal(t, "host-Z2l0aHViLmNvbQ.sds.yaml", sdsFileKeyForHost("github.com"))
	assert.Equal(t, "host-cmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbQ.sds.yaml", sdsFileKeyForHost("raw.githubusercontent.com"))
}

func TestCredentialEnvVars_AnnotationOverridesLegacyDefault(t *testing.T) {
	// Anthropic Secret carrying an explicit annotation overrides what the
	// legacy auth-mode switch would have produced. Tests the annotation-driven path
	// for the typical UI-created Anthropic secret.
	got := credentialEnvVars([]corev1.Secret{
		secretWithEnvMappings(
			"platform-cred-aaa",
			"anthropic",
			`[{"envName":"ANTHROPIC_API_KEY","placeholder":"dummy-placeholder"}]`,
		),
	})
	envs := envByName(got)
	assert.Equal(t, "dummy-placeholder", envs["ANTHROPIC_API_KEY"])
	assert.Len(t, envs, 1)
}

func TestRenderEnvoyBootstrap_QueryParamCredentialRendersLuaFilter(t *testing.T) {
	// A credential with QueryParamName set renders an extra Lua filter
	// after credential_injector. credential_injector writes the (bare)
	// SDS value into the credential's header; Lua moves it into the URL
	// query parameter and strips the header before the request leaves
	// the sidecar.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		queryParamChain("platform-cred-bob", "prod.ibm-bob-staging.cloud.ibm.com", "X-Bobshell-Cred", "key"),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "envoy.filters.http.lua")
	// credential_injector targets the credential's header.
	assert.Contains(t, got, `header: "X-Bobshell-Cred"`)
	// Lua-visible names come through %q so credential bytes can't bind
	// to Lua pattern or backreference syntax.
	assert.Contains(t, got, `local HEADER = "X-Bobshell-Cred"`)
	assert.Contains(t, got, `local PARAM  = "key"`)
	// Credential is percent-encoded before being appended to the URL —
	// without this a value containing `&` or `=` would break out of
	// the query parameter and inject extra params downstream.
	assert.Contains(t, got, "local function urlencode")
	assert.Contains(t, got, "cred = urlencode(cred)")
}

func TestRenderEnvoyBootstrap_HeaderOnlyChainSkipsLua(t *testing.T) {
	// Without QueryParamName the chain has only credential_injector — no
	// Lua. credential_injector writes the pre-formatted SDS value (baked
	// by api-server) directly into the user header.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "envoy.filters.http.lua")
	assert.Contains(t, got, `header: "Authorization"`)
}

func TestRenderEnvoyBootstrap_TwoCredentialsOnSameHostStackInOneChain(t *testing.T) {
	// Multi-secret-per-host merge: two credentials targeting the same SNI
	// stack as two credential_injector entries inside a single TLS chain.
	// Exactly one chain definition, one route-config, one upstream cluster —
	// the second credential MUST NOT spawn a duplicate filter chain.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		twoCredentialChain("platform-cred-header", "platform-cred-query", "prod.ibm-bob-staging.cloud.ibm.com"),
	})
	require.NoError(t, err)

	// Both credential_injector filters in the same chain. We pick the
	// per-route header name (rendered as `header: "<name>"`) so we don't
	// confuse cluster `name:` lines with filter `header:` lines.
	injectorHeaders := strings.Count(got, `header: "Authorization"`)
	assert.Equal(t, 1, injectorHeaders, "header-injection credential renders one Authorization injector")
	assert.Contains(t, got, `header: "X-Internal-Query-platform-cred-query"`)

	// Exactly one filter chain for the host — not two.
	chainCount := strings.Count(got, "name: terminate_chain_platform-cred-header")
	assert.Equal(t, 1, chainCount)

	// Exactly one Lua filter (only the query-injection credential needs it).
	luaCount := strings.Count(got, "envoy.filters.http.lua")
	assert.Equal(t, 1, luaCount)

	// One pinned upstream cluster for the chain (shared by both credentials).
	upstreamCount := strings.Count(got, "- name: upstream_platform-cred-header")
	assert.Equal(t, 1, upstreamCount)
}

func TestChainsFromSecrets_MergesSameHostIntoOneChain(t *testing.T) {
	// Two granted Secrets on the same host → one chain with two
	// envoyCredential entries (in name-sorted order, which the upstream
	// `listOwnerCredentialSecrets` guarantees).
	hdr := ownerSecret("platform-cred-aaa-header", "generic", "")
	hdr.Annotations[envoyHostPatternAnn] = "bob.example.com"
	hdr.Annotations[envoyHeaderNameAnn] = "Authorization"

	qry := ownerSecret("platform-cred-bbb-query", "generic", "")
	qry.Annotations[envoyHostPatternAnn] = "bob.example.com"
	qry.Annotations[envoyHeaderNameAnn] = "X-Query-Cred"
	qry.Annotations[envoyQueryParamAnn] = "key"

	chains := chainsFromSecrets([]corev1.Secret{hdr, qry})
	require.Len(t, chains, 1)
	require.Len(t, chains[0].Credentials, 2)
	assert.Equal(t, "bob.example.com", chains[0].Host)
	assert.Equal(t, "Authorization", chains[0].Credentials[0].HeaderName)
	assert.Equal(t, "X-Query-Cred", chains[0].Credentials[1].HeaderName)
	assert.Equal(t, "key", chains[0].Credentials[1].QueryParamName)
}

func TestChainsFromSecrets_DuplicateHeaderOnSameHostKeepsLexFirst(t *testing.T) {
	// credential_injector overwrite=true means two injectors writing the
	// same header step on each other — the second clobbers the first
	// silently. Drop the later one (input is name-sorted upstream) and
	// emit a warning. api-server should also reject this at create time
	// but defense-in-depth here keeps the gateway up.
	first := ownerSecret("platform-cred-a-first", "generic", "")
	first.Annotations[envoyHostPatternAnn] = "api.example.com"
	first.Annotations[envoyHeaderNameAnn] = "Authorization"

	second := ownerSecret("platform-cred-b-second", "generic", "")
	second.Annotations[envoyHostPatternAnn] = "api.example.com"
	second.Annotations[envoyHeaderNameAnn] = "Authorization"

	chains := chainsFromSecrets([]corev1.Secret{first, second})
	require.Len(t, chains, 1)
	require.Len(t, chains[0].Credentials, 1)
	assert.Equal(t, first.Name, chains[0].Credentials[0].SecretName)
}

func TestChainsFromSecrets_DistinctHostsEachGetTheirOwnChain(t *testing.T) {
	a := ownerSecret("platform-cred-a", "generic", "")
	a.Annotations[envoyHostPatternAnn] = "api.first.com"
	b := ownerSecret("platform-cred-b", "generic", "")
	b.Annotations[envoyHostPatternAnn] = "api.second.com"

	chains := chainsFromSecrets([]corev1.Secret{a, b})
	assert.Len(t, chains, 2)
}

func TestChainsFromSecrets_AllowOnlySecretRendersUncredentialedChain(t *testing.T) {
	// An allow-only Secret on a host renders the chain with zero
	// credentials — the host still terminates TLS for the egress gate,
	// but credential_injector isn't applied and the route forwards via
	// dynamic_forward_proxy (there's nothing to misroute).
	allowOnly := ownerSecret("platform-allow-only-npm", envoySecretTypeAllowOnly, "")
	allowOnly.Annotations[envoyHostPatternAnn] = "registry.npmjs.org"

	chains := chainsFromSecrets([]corev1.Secret{allowOnly})
	require.Len(t, chains, 1)
	assert.Equal(t, "registry.npmjs.org", chains[0].Host)
	assert.Empty(t, chains[0].Credentials)
	assert.False(t, chains[0].Credentialed())
}

func TestChainsFromSecrets_AllowOnlyAndCredentialedOnSameHost(t *testing.T) {
	// Mixed shape: a host with both an allow-only Secret AND a
	// credentialed Secret renders as a credentialed chain. Allow-only
	// contributes nothing — it's a path-policy hint, not an instruction
	// to skip injection.
	cred := ownerSecret("platform-cred-a", "generic", "")
	cred.Annotations[envoyHostPatternAnn] = "api.example.com"
	cred.Annotations[envoyHeaderNameAnn] = "Authorization"

	allowOnly := ownerSecret("platform-allow-only-b", envoySecretTypeAllowOnly, "")
	allowOnly.Annotations[envoyHostPatternAnn] = "api.example.com"

	chains := chainsFromSecrets([]corev1.Secret{cred, allowOnly})
	require.Len(t, chains, 1)
	require.Len(t, chains[0].Credentials, 1)
	assert.Equal(t, cred.Name, chains[0].Credentials[0].SecretName)
	assert.True(t, chains[0].Credentialed())
}

func TestEnvoySecretsRev_QueryParamAnnotationRollsExistingPods(t *testing.T) {
	// Adding the query-param annotation must change the hash so the
	// StatefulSet rolls — the bootstrap shape changes (Lua filter added)
	// and the existing pod would otherwise keep serving the no-filter
	// bootstrap.
	plain := ownerSecret("platform-cred-bob", "generic", "")
	plain.Annotations[envoyHeaderNameAnn] = "X-Bobshell-Credential"

	withParam := ownerSecret("platform-cred-bob", "generic", "")
	withParam.Annotations[envoyHeaderNameAnn] = "X-Bobshell-Credential"
	withParam.Annotations[envoyQueryParamAnn] = "key"

	assert.NotEqual(t, envoySecretsRev([]corev1.Secret{plain}), envoySecretsRev([]corev1.Secret{withParam}))
}

func TestEnvoySecretsRev_InjectionHostsAnnotationRollsExistingPods(t *testing.T) {
	// Editing a connection's host list (descriptor change, #219) must
	// roll the gateway — Envoy reads the bootstrap once at boot, so a
	// chain-shape change without a roll leaves stale chains running.
	before := ownerSecret("platform-conn-github", "connection", "github")
	before.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`

	after := ownerSecret("platform-conn-github", "connection", "github")
	after.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"},
		{"host":"raw.githubusercontent.com"}
	]`

	assert.NotEqual(t,
		envoySecretsRev([]corev1.Secret{before}),
		envoySecretsRev([]corev1.Secret{after}),
		"host-list edits must change the rev so the StatefulSet rolls",
	)
}

func TestEnvoySecretsRev_SDSDataKeysRollExistingPods(t *testing.T) {
	// Chain rendering degrades a host to allow-only when its SDS data key
	// is missing, so a Secret gaining the key back (re-bake, reconnect)
	// changes the chain shape and must roll the gateway.
	missing := ownerSecret("platform-conn-github", "connection", "github")
	missing.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`
	missing.Data = map[string][]byte{"access_token": []byte("gho_abc")}

	healed := ownerSecret("platform-conn-github", "connection", "github")
	healed.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`
	healed.Data = map[string][]byte{"access_token": []byte("gho_abc")}
	healed = withHostSDS(healed, "api.github.com")

	assert.NotEqual(t,
		envoySecretsRev([]corev1.Secret{missing}),
		envoySecretsRev([]corev1.Secret{healed}),
		"SDS data-key changes must change the rev so the StatefulSet rolls",
	)
}

func TestEnvoySecretsRev_TemplateRevBumpRollsExistingPods(t *testing.T) {
	// The rev hash must include a template-revision marker so any structural
	// template change rolls existing pods on chart upgrade. Without it, the
	// rendered ConfigMap diverges but the pod template stays identical and
	// kubelet keeps the old bootstrap mounted.
	rev := envoySecretsRev(nil)
	assert.NotEqual(t, "empty", rev, "secrets-rev must not be a stable sentinel for empty Secret sets — bumping the template rev must change the hash")
	assert.NotEmpty(t, rev)

	// Different Secret sets produce different hashes (regression sanity check
	// — the template marker shouldn't dominate the hash).
	one := envoySecretsRev([]corev1.Secret{ownerSecret("platform-conn-github", "connection", "github")})
	two := envoySecretsRev([]corev1.Secret{ownerSecret("platform-conn-slack", "connection", "slack")})
	assert.NotEqual(t, one, two)
}

func TestCredentialEnvVars_RespectsEnvMappingsAnnotation(t *testing.T) {
	// User-defined mappings on a generic Secret must land on the agent pod —
	// without this, `env: GH_TOKEN=...` configured for a generic GitHub PAT
	// is silently dropped because only anthropic / connection secret types
	// were hardcoded to emit env vars.
	s := ownerSecret("platform-cred-x", "generic", "")
	s.Annotations[envoyEnvMappingsAnn] = `[{"envName":"GH_TOKEN","placeholder":"dummy-placeholder"},{"envName":"OTHER","placeholder":"ph"}]`

	envs := credentialEnvVars([]corev1.Secret{s})

	got := map[string]string{}
	for _, e := range envs {
		got[e.Name] = e.Value
	}
	assert.Equal(t, "dummy-placeholder", got["GH_TOKEN"])
	assert.Equal(t, "ph", got["OTHER"])
}

func TestCredentialEnvVars_DedupesAcrossAnnotationAndHardcoded(t *testing.T) {
	// The anthropic hardcoded path and the env-mappings annotation can
	// agree on the same envName. Dedup must keep a single entry.
	s := ownerSecret("platform-cred-anth", "anthropic", "")
	s.Annotations[envoyAuthModeAnn] = "oauth"
	s.Annotations[envoyEnvMappingsAnn] = `[{"envName":"CLAUDE_CODE_OAUTH_TOKEN","placeholder":"dummy-placeholder"}]`

	envs := credentialEnvVars([]corev1.Secret{s})

	count := 0
	for _, e := range envs {
		if e.Name == "CLAUDE_CODE_OAUTH_TOKEN" {
			count++
		}
	}
	assert.Equal(t, 1, count)
}

func TestCredentialEnvVars_MalformedAnnotationFallsBackCleanly(t *testing.T) {
	// A malformed env-mappings JSON must not skip the per-type fallback or
	// take down the reconcile loop.
	s := ownerSecret("platform-cred-broken", "anthropic", "")
	s.Annotations[envoyAuthModeAnn] = "api-key"
	s.Annotations[envoyEnvMappingsAnn] = "not json"

	envs := credentialEnvVars([]corev1.Secret{s})

	require.Len(t, envs, 1)
	assert.Equal(t, "ANTHROPIC_API_KEY", envs[0].Name)
}

func http2CredentialedChain(secretName, host string) envoyHostChain {
	c := credentialedChain(secretName, host)
	c.HTTP2 = true
	return c
}

func TestRenderEnvoyBootstrap_HTTP2ChainAdvertisesH2AndMirrorsUpstream(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		http2CredentialedChain("platform-cred-modal-id", "api.modal.com"),
	})
	require.NoError(t, err)

	// Downstream terminate chain offers h2 ALPN so a grpclib (HTTP/2) client
	// negotiates HTTP/2 over the MITM leaf cert.
	assert.Contains(t, got, "alpn_protocols")
	assert.Contains(t, got, `"h2"`)
	// Upstream cluster mirrors the negotiated protocol so the gRPC stream is
	// forwarded as HTTP/2 and credential injection lands on it.
	assert.Contains(t, got, "use_downstream_protocol_config")
	assert.Contains(t, got, "HttpProtocolOptions")
}

func TestRenderEnvoyBootstrap_RestChainStaysHTTP1(t *testing.T) {
	// A non-HTTP2 credentialed chain must render byte-for-byte as before:
	// no ALPN, no upstream protocol-options block.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "alpn_protocols")
	assert.NotContains(t, got, "use_downstream_protocol_config")
}

func TestChainsFromSecrets_HTTP2AnnotationMarksChain(t *testing.T) {
	s := ownerSecret("platform-cred-modal-id", "generic", "api.modal.com")
	s.Annotations[envoyHeaderNameAnn] = "x-modal-token-id"
	s.Annotations[envoyInjectionHTTP2Ann] = "true"

	chains := chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 1)
	assert.True(t, chains[0].HTTP2, "http2 annotation must mark the chain")

	// Same secret without the annotation stays HTTP/1.1.
	delete(s.Annotations, envoyInjectionHTTP2Ann)
	chains = chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 1)
	assert.False(t, chains[0].HTTP2)
}

func TestChainsFromSecrets_ConnectionEntryHTTP2MarksChain(t *testing.T) {
	s := ownerSecret("platform-conn-modal", "connection", "modal")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.modal.com","headerName":"x-modal-token-id","http2":true}
	]`
	s = withHostSDS(s, "api.modal.com")

	chains := chainsFromSecrets([]corev1.Secret{s})
	require.Len(t, chains, 1)
	assert.True(t, chains[0].HTTP2, "injection-hosts http2:true must mark the chain")
}

// --- Gateway OTel render tests ---
//
// The gateway is the one platform component that zero-code
// auto-instrumentation can't reach, so its telemetry is configured
// natively in the bootstrap. These tests pin the render-gating (default-off),
// the three signals when enabled, and the credential-redaction invariants that
// make tracing/logging safe on a credential-injecting MITM proxy.

// otelCfg returns a copy of bootstrapTestCfg with the OTLP endpoint the
// controller would have inherited. Empty endpoint = off.
func otelCfg(otlpEndpoint string) *config.Config {
	c := *bootstrapTestCfg
	c.OTelEnv = map[string]string{}
	if otlpEndpoint != "" {
		c.OTelEnv["OTEL_EXPORTER_OTLP_ENDPOINT"] = otlpEndpoint
	}
	return &c
}

// otelCfgEnv builds a config from an explicit OTEL_* environment, for
// exercising protocol / sampling knobs.
func otelCfgEnv(env map[string]string) *config.Config {
	c := *bootstrapTestCfg
	c.OTelEnv = env
	return &c
}

const testOTLPEndpoint = "http://otel-collector.platform.svc.cluster.local:4317"

func TestRenderEnvoyBootstrap_TelemetryOffWithoutEndpoint(t *testing.T) {
	// No inherited OTLP endpoint → no telemetry config of any kind, so an
	// uninstrumented platform's gateways behave exactly as before.
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "OpenTelemetryConfig")
	assert.NotContains(t, got, "access_log")
	assert.NotContains(t, got, "stats_sinks")
	assert.NotContains(t, got, "otel_export")
}

func TestRenderEnvoyBootstrap_TelemetryAllSignals(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfg(testOTLPEndpoint), []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)

	// Tracing provider with the shared service.name.
	assert.Contains(t, got, "type.googleapis.com/envoy.config.trace.v3.OpenTelemetryConfig")
	assert.Contains(t, got, `service_name: "platform-agent-gateway"`)
	assert.Contains(t, got, "resource_detectors")

	// gRPC transport (default protocol): the tracer uses grpc_service, not
	// http_service. (grpc_service also appears for ext_authz, so scope to the
	// tracer block.)
	assert.Contains(t, otelTracerBlock(got), "grpc_service")
	assert.NotContains(t, otelTracerBlock(got), "http_service")

	// Default full sampling. Anchored to the random_sampling key — a bare
	// "value: 100" is a substring of the listener's "port_value: 10000".
	assert.Regexp(t, `random_sampling:\s*\n\s*value: 100\n`, got)

	// Metrics: OTLP stats sink, no admin interface needed.
	assert.Contains(t, got, "stats_sinks")
	assert.Contains(t, got, "envoy.stat_sinks.open_telemetry")

	// Collector cluster address parsed from the inherited endpoint.
	assert.Contains(t, got, "- name: otel_export")
	assert.Contains(t, got, "address: otel-collector.platform.svc.cluster.local")
	assert.Contains(t, got, "port_value: 4317")

	// Access logs present and credential-safe — on stdout AND exported over
	// OTLP so they land in the telemetry backend.
	assert.Contains(t, got, "envoy.access_loggers.file")
	assert.Contains(t, got, "envoy.access_loggers.open_telemetry")
	assert.Contains(t, got, "%REQ_WITHOUT_QUERY(:PATH)%")
}

func TestRenderEnvoyBootstrap_HTTPProtocol(t *testing.T) {
	// OTLP/HTTP exporter → http_service to /v1/traces, HTTP/1.1 collector cluster,
	// and NO stats sink (Envoy's OTel stats sink only speaks gRPC).
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfgEnv(map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel.platform.svc:4318",
		"OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
	}), nil)
	require.NoError(t, err)
	tracer := otelTracerBlock(got)
	assert.Contains(t, tracer, "http_service")
	assert.Contains(t, tracer, `uri: "http://otel.platform.svc:4318/v1/traces"`)
	assert.NotContains(t, tracer, "grpc_service") // ext_authz uses grpc_service; the tracer must not
	assert.NotContains(t, got, "stats_sinks")
	// OTLP access logs work over HTTP too (unlike the stats sink).
	assert.Contains(t, got, "envoy.access_loggers.open_telemetry")
	assert.Contains(t, got, `uri: "http://otel.platform.svc:4318/v1/logs"`)
	var doc map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(got), &doc), "OTLP/HTTP render must stay valid YAML")
	// HTTP/1.1 collector — no http2 protocol options on the cluster.
	collectorBlock := got[strings.Index(got, "- name: otel_export"):]
	assert.NotContains(t, collectorBlock, "http2_protocol_options")
}

// otelTracerBlock returns the OpenTelemetryConfig provider block (from its
// @type to resource_detectors), so transport assertions don't catch the
// unrelated ext_authz grpc_service.
func otelTracerBlock(s string) string {
	start := strings.Index(s, "envoy.config.trace.v3.OpenTelemetryConfig")
	if start < 0 {
		return ""
	}
	rest := s[start:]
	if end := strings.Index(rest, "resource_detectors"); end >= 0 {
		return rest[:end]
	}
	return rest
}

func TestRenderEnvoyBootstrap_SamplingFromEnv(t *testing.T) {
	// OTEL_TRACES_SAMPLER_ARG flows into the HCM random_sampling percentage.
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfgEnv(map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": testOTLPEndpoint,
		"OTEL_TRACES_SAMPLER":         "parentbased_traceidratio",
		"OTEL_TRACES_SAMPLER_ARG":     "0.1",
	}), nil)
	require.NoError(t, err)
	// Anchored: a bare "value: 10" is a substring of "port_value: 10000".
	assert.Regexp(t, `random_sampling:\s*\n\s*value: 10\n`, got)
}

func TestRenderEnvoyBootstrap_PlaintextCollectorNoUpstreamTLS(t *testing.T) {
	// http:// endpoint → plaintext gRPC; no upstream TLS on the collector cluster.
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfg("http://otel:4317"), nil)
	require.NoError(t, err)
	require.Contains(t, got, "- name: otel_export")
	collectorBlock := got[strings.Index(got, "- name: otel_export"):]
	assert.NotContains(t, collectorBlock, "UpstreamTlsContext")
}

func TestRenderEnvoyBootstrap_HTTPSCollectorGetsUpstreamTLS(t *testing.T) {
	// https:// endpoint → the collector cluster is wrapped in upstream TLS.
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfg("https://otel.example.com:4318"), nil)
	require.NoError(t, err)
	assert.Contains(t, got, "address: otel.example.com")
	assert.Contains(t, got, "port_value: 4318")
	collectorBlock := got[strings.Index(got, "- name: otel_export"):]
	assert.Contains(t, collectorBlock, "UpstreamTlsContext")
	assert.Contains(t, collectorBlock, "sni: otel.example.com")
}

func TestRenderEnvoyBootstrap_TracingNotOnCredentialChains(t *testing.T) {
	// The post-MITM credential-injection chains must NOT get a tracing provider:
	// their :path can hold a query-param credential and Envoy has no span-tag
	// query stripper. Tracing lives only on the outer agent_egress HCM, so the
	// provider appears exactly once even with two credentialed chains.
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfg(testOTLPEndpoint), []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
		credentialedChain("platform-conn-anthropic", "api.anthropic.com"),
	})
	require.NoError(t, err)
	assert.Equal(t, 1, strings.Count(got, "OpenTelemetryConfig"),
		"tracing provider must be on the outer egress HCM only, not per credential chain")
}

func TestRenderEnvoyBootstrap_AccessLogNeverLogsCredentials(t *testing.T) {
	// The proxy injects credentials as an Authorization header AND as URL query
	// params. The access log must reference neither: no Authorization-header
	// operator, and the path goes through REQ_WITHOUT_QUERY so the query string
	// (where the Lua filter parks query-param credentials) is dropped.
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfg(testOTLPEndpoint), []envoyHostChain{
		queryParamChain("platform-cred-q", "api.example.com", "X-Key", "key"),
	})
	require.NoError(t, err)
	assert.Contains(t, got, "%REQ_WITHOUT_QUERY(:PATH)%")
	// The naive path operator would include the query string — must not appear.
	assert.NotContains(t, got, "%REQ(:PATH)%")
	assert.NotContains(t, strings.ToLower(got), "req(authorization)")
}

func TestRenderEnvoyBootstrap_ExternalEgressStripsTraceContext(t *testing.T) {
	// Internal trace context must not leak to external HTTP upstreams.
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", otelCfg(testOTLPEndpoint), nil)
	require.NoError(t, err)
	assert.Contains(t, got, "request_headers_to_remove: [ traceparent, tracestate ]")
}

func TestEnvoyContainer_RelaysOTelEnvWithGatewayIdentity(t *testing.T) {
	// The controller relays its inherited OTEL_* env onto the gateway generically,
	// but the gateway's own identity overrides the controller's: service.name is
	// owned by the tracer config (OTEL_SERVICE_NAME not relayed), and
	// OTEL_RESOURCE_ATTRIBUTES is set fresh with the bounded platform.gateway.id.
	cfg := *bootstrapTestCfg
	cfg.OTelEnv = map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel:4317",
		"OTEL_TRACES_SAMPLER":         "parentbased_always_on",
		"OTEL_SERVICE_NAME":           "platform-controller",         // controller identity
		"OTEL_RESOURCE_ATTRIBUTES":    "k8s.pod.name=controller-0",   // controller identity
		"OTEL_EXPORTER_OTLP_HEADERS":  "Authorization=Bearer secret", // inert for Envoy; may carry a token
	}
	env := map[string]string{}
	for _, e := range envoyContainer("agent-7", &cfg, nil).Env {
		env[e.Name] = e.Value
	}
	assert.Equal(t, "http://otel:4317", env["OTEL_EXPORTER_OTLP_ENDPOINT"])
	assert.Equal(t, "parentbased_always_on", env["OTEL_TRACES_SAMPLER"])
	_, relayedServiceName := env["OTEL_SERVICE_NAME"]
	assert.False(t, relayedServiceName, "controller's service.name must not ride onto the gateway")
	_, relayedHeaders := env["OTEL_EXPORTER_OTLP_HEADERS"]
	assert.False(t, relayedHeaders, "collector auth headers (Envoy can't use them, may hold a token) must not ride onto the gateway")
	assert.Equal(t, "platform.gateway.id=agent-7,k8s.namespace.name=agents", env["OTEL_RESOURCE_ATTRIBUTES"])
}

func TestEnvoyContainer_NoOTelEnvWhenDisabled(t *testing.T) {
	assert.Empty(t, envoyContainer("agent-7", bootstrapTestCfg, nil).Env)
}

func TestRenderEnvoyBootstrap_TransitAndOTelCoexist(t *testing.T) {
	// The bundled backend enables BOTH gateway telemetry features at once: the
	// agent-telemetry transit chain (PLATFORM_TELEMETRY_COLLECTOR_*) and the
	// gateway's own OTel export (relayed OTEL_*). They must render side by
	// side with distinct cluster names — a duplicate cluster name is a fatal
	// Envoy config error that would crash-loop every gateway.
	cfg := telemetryTestCfg()
	cfg.OTelEnv = map[string]string{
		// Same bundled collector, gRPC port so the stats sink renders too.
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://platform-clickstack-collector.platform.svc.cluster.local:4317",
	}
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", cfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)

	var doc map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(got), &doc), "rendered bootstrap must be valid YAML")

	// Both features present: transit chain, tracer, stats sink.
	assert.Contains(t, got, "- name: terminate_otel_collector")
	assert.Contains(t, got, "OpenTelemetryConfig")
	assert.Contains(t, got, "stats_sinks")

	// Every cluster name is unique — the invariant the split otel_collector /
	// otel_export naming protects.
	static, _ := doc["static_resources"].(map[string]any)
	clusters, _ := static["clusters"].([]any)
	require.NotEmpty(t, clusters)
	seen := map[string]bool{}
	for _, c := range clusters {
		name, _ := c.(map[string]any)["name"].(string)
		require.False(t, seen[name], "duplicate cluster name %q", name)
		seen[name] = true
	}
	assert.True(t, seen["otel_collector"], "transit cluster must render")
	assert.True(t, seen["otel_export"], "own-telemetry exporter cluster must render")
}

func TestEnvoyVolumes_NoLeafWhenOTelOnlyNoSecrets(t *testing.T) {
	// OTel-only (no transit telemetry, no Secrets): the gateway's own export
	// terminates no TLS, so the leaf cert must NOT be required — a missing
	// leaf Secret would otherwise block the pod on a volume that never fills.
	cfg := otelCfg(testOTLPEndpoint)
	assert.False(t, hasVolumeNamed(envoyVolumes("inst-1", cfg, nil), envoyLeafTLSVolume))
	assert.False(t, hasMountNamed(envoyContainer("inst-1", cfg, nil).VolumeMounts, envoyLeafTLSVolume))
}

func TestRenderEnvoyBootstrap_CollectorConnectNotTraced(t *testing.T) {
	// With transit + OTel both on, collector-bound CONNECTs get a dedicated
	// route sampled to zero — the pipeline must not trace its own pushes.
	cfg := telemetryTestCfg()
	cfg.OTelEnv = map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": testOTLPEndpoint}
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", cfg, nil)
	require.NoError(t, err)
	assert.Contains(t, got, `exact: "platform-clickstack-collector.platform.svc.cluster.local:4318"`)
	assert.Regexp(t, `tracing:\s*\n\s*random_sampling:\s*\n\s*numerator: 0\n\s*overall_sampling:\s*\n\s*numerator: 0`, got)

	// Transit without OTel tracing: no tracer, so no exclusion route either.
	got, err = renderEnvoyBootstrap("agent-7", "agent-7", telemetryTestCfg(), nil)
	require.NoError(t, err)
	assert.NotContains(t, got, "numerator: 0")
}

func TestRenderEnvoyBootstrap_TransitChainErrorOnlyAccessLog(t *testing.T) {
	// Delivery failures on the transit chain must reach the pod log (the chain
	// has no tracing by design and stats are off on OTLP/HTTP), but success
	// traffic must not be logged — the filter admits errors only.
	cfg := telemetryTestCfg()
	cfg.OTelEnv = map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": testOTLPEndpoint}
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", cfg, nil)
	require.NoError(t, err)
	cs := strings.Index(got, "- name: terminate_otel_collector")
	ce := strings.Index(got, "# SNI miss")
	require.True(t, cs >= 0 && ce > cs)
	chain := got[cs:ce]
	assert.Contains(t, chain, "access_log")
	assert.Contains(t, chain, "status_code_filter")
	assert.Contains(t, chain, "response_flag_filter")

	// Without OTel, the transit chain renders as on main — no access log.
	got, err = renderEnvoyBootstrap("agent-7", "agent-7", telemetryTestCfg(), nil)
	require.NoError(t, err)
	cs = strings.Index(got, "- name: terminate_otel_collector")
	ce = strings.Index(got, "# SNI miss")
	require.True(t, cs >= 0 && ce > cs)
	assert.NotContains(t, got[cs:ce], "access_log")
}

func TestRenderEnvoyBootstrap_GatewayOverrideDecouplesFromControllerEnv(t *testing.T) {
	// Bundled-backend shape: the controller SDK env stays OTLP/HTTP :4318
	// while PLATFORM_GATEWAY_OTLP_* points gateways at gRPC :4317 — all three
	// signals render over gRPC and the controller env is never consulted for
	// transport.
	cfg := *bootstrapTestCfg
	cfg.OTelEnv = map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.platform.svc:4318",
		"OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
	}
	cfg.GatewayOTLPEndpoint = "http://collector.platform.svc:4317"
	cfg.GatewayOTLPProtocol = "grpc"
	got, err := renderEnvoyBootstrap("agent-7", "agent-7", &cfg, nil)
	require.NoError(t, err)

	assert.Contains(t, got, "stats_sinks", "gRPC override must enable the stats sink")
	assert.Contains(t, otelTracerBlock(got), "grpc_service")
	assert.Contains(t, got, "envoy.access_loggers.open_telemetry")
	assert.NotContains(t, got, "/v1/traces", "no OTLP/HTTP branch may render under the gRPC override")
	assert.Contains(t, got, "port_value: 4317")

	// The pod env states the effective exporter, not the controller's own —
	// truthful, and the roll trigger when the override changes.
	env := map[string]string{}
	for _, e := range envoyContainer("agent-7", &cfg, nil).Env {
		env[e.Name] = e.Value
	}
	assert.Equal(t, "http://collector.platform.svc:4317", env["OTEL_EXPORTER_OTLP_ENDPOINT"])
	assert.Equal(t, "grpc", env["OTEL_EXPORTER_OTLP_PROTOCOL"])
}
