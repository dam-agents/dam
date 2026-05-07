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

var bootstrapTestCfg = &config.Config{
	Namespace:           "agents",
	EnvoyPort:           10000,
	ExtAuthzHost:        "platform-apiserver.platform.svc",
	ExtAuthzPort:        50051,
	ExtAuthzHoldSeconds: 30,
}

func credentialedRoute(secretName, host string) envoyRoute {
	return envoyRoute{
		SecretName:   secretName,
		Host:         host,
		HeaderName:   "Authorization",
		VolumeName:   "cred-" + secretName,
		Credentialed: true,
	}
}

func allowOnlyRoute(secretName, host string) envoyRoute {
	return envoyRoute{
		SecretName:   secretName,
		Host:         host,
		VolumeName:   "cred-" + secretName,
		Credentialed: false,
	}
}

func TestRenderEnvoyBootstrap_CredentialedRoutePinnedToStaticCluster(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyRoute{
		credentialedRoute("platform-conn-github", "api.github.com"),
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

func TestRenderEnvoyBootstrap_NoCredentialedRouteForwardsViaDynamicForwardProxy(t *testing.T) {
	// With no credentialed routes there should be no per-credential cluster
	// and no host_rewrite_literal — the catch-all/L4 paths still use
	// dynamic_forward_proxy clusters but those are non-credentialed.
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyRoute{
		allowOnlyRoute("platform-allow-only-npm", "registry.npmjs.org"),
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
	got, err := renderEnvoyBootstrap("inst-1", bootstrapTestCfg, []envoyRoute{
		credentialedRoute("platform-conn-github", "api.github.com"),
		allowOnlyRoute("platform-allow-only-npm", "registry.npmjs.org"),
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
