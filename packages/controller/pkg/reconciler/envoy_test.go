package reconciler

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	}
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
	// Always-selective: empty/absent grant annotations grant nothing.
	got := filterByGrants(secrets, nil)
	assert.Empty(t, got)
}

func TestFilterByGrants_SelectiveSecretsDropUngranted(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-cred-bbb", "generic", ""),
	}
	got := filterByGrants(secrets, map[string]string{
		grantSecretIdsAnn: "aaa",
	})
	assert.Equal(t, []string{"platform-cred-aaa"}, names(got))
}

func TestFilterByGrants_EmptySecretListGrantsNothing(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-cred-bbb", "generic", ""),
	}
	got := filterByGrants(secrets, map[string]string{
		grantSecretIdsAnn: "",
	})
	assert.Empty(t, got)
}

func TestFilterByGrants_ConnectionGrantsByList(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-conn-github", "connection", "github"),
		ownerSecret("platform-conn-slack", "connection", "slack"),
	}
	got := filterByGrants(secrets, map[string]string{
		grantConnectionIdsAnn: "github",
	})
	assert.Equal(t, []string{"platform-conn-github"}, names(got))

	// Empty list → nothing granted.
	got = filterByGrants(secrets, map[string]string{
		grantConnectionIdsAnn: "",
	})
	assert.Empty(t, got)
}

func TestFilterByGrants_SecretAndConnectionAxesAreIndependent(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-cred-bbb", "generic", ""),
		ownerSecret("platform-conn-github", "connection", "github"),
		ownerSecret("platform-conn-slack", "connection", "slack"),
	}
	got := filterByGrants(secrets, map[string]string{
		grantSecretIdsAnn:     "aaa",
		grantConnectionIdsAnn: "slack",
	})
	assert.ElementsMatch(t, []string{"platform-cred-aaa", "platform-conn-slack"}, names(got))
}

// --- Bootstrap render tests ---
//
// These cover the security-critical shape of the rendered Envoy config:
// credentialed chains forward to a per-credential static cluster pinned to
// the credential's host with SAN-bound upstream TLS validation; the agent's
// inner Host header has no influence on routing. The route-confusion
// exfiltration path called out in ADR-033 §Threat Model is structurally
// closed by these properties — the assertions below are the regression spec.

// ADR-041: ExtAuthzHost is no longer a flat config field — it is computed
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyHostChain{
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, nil)
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyHostChain{
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyHostChain{
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
	// ADR-041: the secret's `env-mappings` annotation is the source of truth
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
	// smallest one wins via the inner dedup. ADR-041 §Precedence.
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
	// Anthropic env. Hand-edited Secrets and pre-ADR-041 fixtures rely on
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

func TestSDSFileKeyForHost_StableAndShort(t *testing.T) {
	// Pinned against the api-server's `sdsFileKeyForHost`. Mismatch =
	// gateway reads a missing file.
	assert.Equal(t, "host-01892413.sds.yaml", sdsFileKeyForHost("api.github.com"))
	assert.Equal(t, "host-c2208abd.sds.yaml", sdsFileKeyForHost("github.com"))
	assert.Equal(t, "host-3cf88e0a.sds.yaml", sdsFileKeyForHost("raw.githubusercontent.com"))
}

func TestCredentialEnvVars_AnnotationOverridesLegacyDefault(t *testing.T) {
	// Anthropic Secret carrying an explicit annotation overrides what the
	// legacy auth-mode switch would have produced. Tests the ADR-041 path
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyHostChain{
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyHostChain{
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyHostChain{
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
