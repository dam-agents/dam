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
		Data: map[string][]byte{envoyCredentialKeySDS: []byte("resources: []")},
	}
}

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

	got = filterByGrants(secrets, nil, []string{})
	assert.Empty(t, got)
}

func TestFilterByGrants_AllowOnlyPassesThroughUngranted(t *testing.T) {
	secrets := []corev1.Secret{
		ownerSecret("platform-allow-abc12345-api-example-com", envoySecretTypeAllowOnly, ""),
		ownerSecret("platform-cred-aaa", "anthropic", ""),
		ownerSecret("platform-conn-github", "connection", "github"),
	}

	got := filterByGrants(secrets, nil, nil)
	assert.Equal(t, []string{"platform-allow-abc12345-api-example-com"}, names(got))

	got = filterByGrants(secrets, []string{"aaa"}, []string{"github"})
	assert.ElementsMatch(t,
		[]string{"platform-allow-abc12345-api-example-com", "platform-cred-aaa", "platform-conn-github"},
		names(got))
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

var bootstrapTestCfg = &config.Config{
	Namespace:           "agents",
	ReleaseName:         "platform",
	ReleaseNamespace:    "platform",
	HarnessServerPort:   4001,
	EnvoyPort:           10000,
	ExtAuthzPort:        50051,
	ExtAuthzHoldSeconds: 30,
}

func mustParseBootstrap(t *testing.T, s string) map[string]any {
	t.Helper()
	var doc map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(s), &doc), "rendered bootstrap must be valid YAML")
	return doc
}

func bootstrapClusters(t *testing.T, doc map[string]any) []map[string]any {
	t.Helper()
	sr, _ := doc["static_resources"].(map[string]any)
	raw, _ := sr["clusters"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, c := range raw {
		if m, ok := c.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func clusterNamed(t *testing.T, doc map[string]any, name string) map[string]any {
	t.Helper()
	for _, c := range bootstrapClusters(t, doc) {
		if c["name"] == name {
			return c
		}
	}
	return nil
}

func countClustersWithPrefix(t *testing.T, doc map[string]any, p string) int {
	t.Helper()
	n := 0
	for _, c := range bootstrapClusters(t, doc) {
		if name, ok := c["name"].(string); ok && strings.HasPrefix(name, p) {
			n++
		}
	}
	return n
}

func internalFilterChains(t *testing.T, doc map[string]any) []map[string]any {
	t.Helper()
	sr, _ := doc["static_resources"].(map[string]any)
	listeners, _ := sr["listeners"].([]any)
	for _, l := range listeners {
		lm, _ := l.(map[string]any)
		if lm["name"] != "tls_inspect_internal" {
			continue
		}
		raw, _ := lm["filter_chains"].([]any)
		out := make([]map[string]any, 0, len(raw))
		for _, c := range raw {
			if m, ok := c.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func filterChainNamed(t *testing.T, doc map[string]any, name string) map[string]any {
	t.Helper()
	for _, c := range internalFilterChains(t, doc) {
		if c["name"] == name {
			return c
		}
	}
	return nil
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
			SDSFileKey: sdsFileKeyForHost(host),
		}},
	}
}

func allowOnlyChain(secretName, host string) envoyHostChain {
	return envoyHostChain{
		ChainID:         "chain_" + secretName,
		UpstreamCluster: "upstream_" + secretName,
		Host:            host,
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
			SDSFileKey:     sdsFileKeyForHost(host),
		}},
	}
}

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
				SDSFileKey: sdsFileKeyForHost(host),
			},
			{
				SecretName:     secondName,
				HeaderName:     "X-Internal-Query-" + secondName,
				QueryParamName: "key",
				SDSFileKey:     sdsFileKeyForHost(host),
				VolumeName:     "cred-" + secondName,
			},
		},
	}
}

func TestRenderEnvoyBootstrap_CredentialedRoutePinnedToStaticCluster(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "name: upstream_platform-conn-github")
	assert.Contains(t, got, "type: STRICT_DNS")
	assert.Contains(t, got, "address: api.github.com")
	assert.Contains(t, got, "port_value: 443")

	assert.Contains(t, got, "dns_lookup_family: V4_PREFERRED")

	assert.Contains(t, got, "sni: api.github.com")
	assert.Contains(t, got, "match_typed_subject_alt_names")
	assert.Regexp(t, `match_typed_subject_alt_names:\s*\n\s*-\s*matcher:\s*\n\s*exact:\s*api\.github\.com\s*\n\s*san_type:\s*DNS`, got)

	assert.Contains(t, got, "cluster: upstream_platform-conn-github")
	assert.Contains(t, got, "host_rewrite_literal: api.github.com")
}

func TestRenderEnvoyBootstrap_EmptyRoutesNoLeafTLSReferences(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, nil)
	require.NoError(t, err)
	assert.NotContains(t, got, "tls.key",
		"empty-routes bootstrap must not reference the leaf TLS private key — pod has no envoy-tls volume to back it")
	assert.NotContains(t, got, "tls.crt",
		"empty-routes bootstrap must not reference the leaf TLS cert chain — pod has no envoy-tls volume to back it")
	assert.Contains(t, got, "l4_authz_passthrough")
}

func TestRenderEnvoyBootstrap_ObjectStoreRoutesRenderedWhenConfigured(t *testing.T) {
	cfg := *bootstrapTestCfg
	cfg.ObjectStoreHost = "platform-seaweedfs.platform.svc.cluster.local"
	cfg.ObjectStorePort = 8333
	got, err := renderEnvoyBootstrap("inst-1", "", &cfg, nil)
	require.NoError(t, err)

	assert.Contains(t, got, "exact: platform-seaweedfs.platform.svc.cluster.local:8333")
	assert.Contains(t, got, "cluster: objectstore_passthrough")
	assert.Contains(t, got, "name: objectstore_passthrough")
	assert.Contains(t, got, "address: platform-seaweedfs.platform.svc.cluster.local")
	assert.Contains(t, got, "port_value: 8333")
}

func TestRenderEnvoyBootstrap_NoObjectStoreNoStoreRoutes(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, nil)
	require.NoError(t, err)
	assert.NotContains(t, got, "objectstore_passthrough")
}

func TestRenderEnvoyBootstrap_NoCredentialedRouteForwardsViaDynamicForwardProxy(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		allowOnlyChain("platform-allow-only-npm", "registry.npmjs.org"),
	})
	require.NoError(t, err)

	assert.NotContains(t, got, "upstream_platform-allow-only-npm")
	assert.NotContains(t, got, "host_rewrite_literal")
	assert.Contains(t, got, "cluster: dynamic_forward_proxy_https")
}

func TestRenderEnvoyBootstrap_MixedRoutesOnlyPinCredentialed(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
		allowOnlyChain("platform-allow-only-npm", "registry.npmjs.org"),
	})
	require.NoError(t, err)

	doc := mustParseBootstrap(t, got)
	assert.Equal(t, 1, countClustersWithPrefix(t, doc, "upstream_"),
		"exactly one pinned upstream cluster should be rendered (credentialed routes only)")
	assert.NotNil(t, clusterNamed(t, doc, "upstream_platform-conn-github"))
	assert.Nil(t, clusterNamed(t, doc, "upstream_platform-allow-only-npm"))
}

func telemetryTestCfg() *config.Config {
	c := *bootstrapTestCfg
	c.TelemetryCollectorHost = "platform-clickstack-collector.platform.svc.cluster.local"
	c.TelemetryCollectorPort = 4318
	return &c
}

func TestRenderEnvoyBootstrap_TelemetryStampsTrustedAgentID(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", telemetryTestCfg(), nil)
	require.NoError(t, err)

	doc := mustParseBootstrap(t, got)

	chain := filterChainNamed(t, doc, "terminate_otel_collector")
	require.NotNil(t, chain, "a dedicated collector filter chain must exist")
	match, _ := chain["filter_chain_match"].(map[string]any)
	assert.Equal(t, []any{"platform-clickstack-collector.platform.svc.cluster.local"}, match["server_names"])

	assert.Contains(t, got, "key: x-platform-agent-id")
	assert.Contains(t, got, "value: inst-1")
	assert.Contains(t, got, "OVERWRITE_IF_EXISTS_OR_ADD")

	assert.NotContains(t, got, "key: x-platform-invocation-id",
		"invocation id must not be stamped without an override")
	assert.Contains(t, got, "request_headers_to_remove")
	assert.Contains(t, got, "x-platform-invocation-id",
		"the strip (request_headers_to_remove) still names the header")

	chainYAML, err := yaml.Marshal(chain)
	require.NoError(t, err)
	assert.NotContains(t, string(chainYAML), "ext_authz")
	assert.NotContains(t, string(chainYAML), "credential_injector")

	cluster := clusterNamed(t, doc, "otel_collector")
	require.NotNil(t, cluster, "a pinned collector cluster must exist")
	assert.Equal(t, "STRICT_DNS", cluster["type"])
	assert.NotContains(t, cluster, "transport_socket")
	assert.Contains(t, got, "address: platform-clickstack-collector.platform.svc.cluster.local")
	assert.Contains(t, got, "port_value: 4318")
}

func TestRenderEnvoyBootstrap_TelemetryRendersValidYAML(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", telemetryTestCfg(), []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	doc := mustParseBootstrap(t, got)
	assert.NotNil(t, filterChainNamed(t, doc, "terminate_otel_collector"))
	assert.NotNil(t, clusterNamed(t, doc, "otel_collector"))
	assert.NotNil(t, clusterNamed(t, doc, "upstream_platform-conn-github"))
}

func TestRenderEnvoyBootstrap_TelemetryDisabledNoCollectorChain(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, nil)
	require.NoError(t, err)
	assert.NotContains(t, got, "terminate_otel_collector")
	assert.NotContains(t, got, "otel_collector")
	assert.NotContains(t, got, "x-platform-agent-id")
}

func TestRenderEnvoyBootstrap_TelemetryAttributionOverride(t *testing.T) {
	got, err := renderEnvoyBootstrap("target-1", "driver-root", telemetryTestCfg(), nil)
	require.NoError(t, err)

	assert.Contains(t, got, "key: x-platform-agent-id")
	assert.Contains(t, got, "value: driver-root")

	assert.Contains(t, got, "key: x-platform-invocation-id")
	assert.Contains(t, got, "value: target-1")
	assert.Contains(t, got, "OVERWRITE_IF_EXISTS_OR_ADD")

	doc := mustParseBootstrap(t, got)
	chain := filterChainNamed(t, doc, "terminate_otel_collector")
	require.NotNil(t, chain)
	chainYAML, err := yaml.Marshal(chain)
	require.NoError(t, err)
	assert.NotContains(t, string(chainYAML), "request_headers_to_remove")
}

func TestRenderEnvoyBootstrap_TelemetryAttributionOverrideEqualToInstanceIsNoop(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "inst-1", telemetryTestCfg(), nil)
	require.NoError(t, err)
	assert.Contains(t, got, "value: inst-1")
	assert.NotContains(t, got, "key: x-platform-invocation-id")
	assert.Contains(t, got, "request_headers_to_remove")
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
	cfg := telemetryTestCfg()
	assert.True(t, hasVolumeNamed(envoyVolumes("inst-1", cfg, nil, nil), envoyLeafTLSVolume),
		"leaf TLS volume must be present when telemetry is on even with no Secrets")
	assert.True(t, hasMountNamed(envoyContainer("inst-1", cfg, nil, nil).VolumeMounts, envoyLeafTLSVolume),
		"leaf TLS mount must be present when telemetry is on even with no Secrets")
}

func TestEnvoyVolumes_NoLeafWhenNoSecretsNoTelemetry(t *testing.T) {
	assert.False(t, hasVolumeNamed(envoyVolumes("inst-1", bootstrapTestCfg, nil, nil), envoyLeafTLSVolume))
	assert.False(t, hasMountNamed(envoyContainer("inst-1", bootstrapTestCfg, nil, nil).VolumeMounts, envoyLeafTLSVolume))
}

func TestRenderEnvoyBootstrap_TelemetryHostCollisionSuppressesCollectorChain(t *testing.T) {
	cfg := telemetryTestCfg()
	got, err := renderEnvoyBootstrap("inst-1", "", cfg, []envoyHostChain{
		credentialedChain("platform-conn-collector", cfg.TelemetryCollectorHost),
	})
	require.NoError(t, err)
	doc := mustParseBootstrap(t, got)
	assert.Nil(t, filterChainNamed(t, doc, "terminate_otel_collector"),
		"collector chain must be suppressed when its host collides with a credentialed chain")
	assert.Nil(t, clusterNamed(t, doc, "otel_collector"),
		"collector cluster must be suppressed alongside its chain")
}

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

func TestCredentialEnvVars_ConnectionEnvMappingsDeclareTheVars(t *testing.T) {
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
	assert.Equal(t, "ghe.example.com", envs["GH_HOST"])
}

func TestChainsFromSecrets_ConnectionSecretFansIntoNChains(t *testing.T) {
	s := ownerSecret("platform-conn-github", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"},
		{"host":"raw.githubusercontent.com"}
	]`
	s = withHostSDS(s, "api.github.com", "github.com", "raw.githubusercontent.com")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 3)

	hosts := []string{chains[0].Host, chains[1].Host, chains[2].Host}
	assert.ElementsMatch(t,
		[]string{"api.github.com", "github.com", "raw.githubusercontent.com"},
		hosts,
	)

	for _, c := range chains {
		require.Len(t, c.Credentials, 1)
		cred := c.Credentials[0]
		assert.Equal(t, "cred-platform-conn-github", cred.VolumeName)
		assert.Equal(t, sdsFileKeyForHost(c.Host), cred.SDSFileKey)
	}
}

func TestChainsFromSecrets_MultiHostSecretYieldsDistinctClusterNames(t *testing.T) {
	s := ownerSecret("platform-conn-github", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"},
		{"host":"raw.githubusercontent.com"}
	]`
	s = withHostSDS(s, "api.github.com", "github.com", "raw.githubusercontent.com")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
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
	s := ownerSecret("platform-conn-347e511ae0055405-64b2b6d12bfe4baa", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`
	s.Data = map[string][]byte{
		"access_token":           []byte("gho_abc"),
		"host-1a2b3c4d.sds.yaml": []byte("resources: []"),
	}

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 1)
	assert.Equal(t, "api.github.com", chains[0].Host)
	assert.False(t, chains[0].Credentialed(),
		"missing SDS data key must degrade to allow-only, not render an unbootable bootstrap")
}

func TestChainsFromSecrets_ConnectionPartialSDSKeysDegradePerHost(t *testing.T) {
	s := ownerSecret("platform-conn-github", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"}
	]`
	s = withHostSDS(s, "api.github.com")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 2)
	byHost := map[string]envoyHostChain{}
	for _, c := range chains {
		byHost[c.Host] = c
	}
	assert.True(t, byHost["api.github.com"].Credentialed())
	assert.False(t, byHost["github.com"].Credentialed())
}

func TestSDSFileKeyForHost_StableAndShort(t *testing.T) {
	assert.Equal(t, "host-YXBpLmdpdGh1Yi5jb20.sds.yaml", sdsFileKeyForHost("api.github.com"))
	assert.Equal(t, "host-Z2l0aHViLmNvbQ.sds.yaml", sdsFileKeyForHost("github.com"))
	assert.Equal(t, "host-cmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbQ.sds.yaml", sdsFileKeyForHost("raw.githubusercontent.com"))
}

func TestRenderEnvoyBootstrap_QueryParamCredentialRendersLuaFilter(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		queryParamChain("platform-cred-bob", "prod.ibm-bob-staging.cloud.ibm.com", "X-Bobshell-Cred", "key"),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "envoy.filters.http.lua")
	assert.Contains(t, got, "header: X-Bobshell-Cred")
	assert.Contains(t, got, `local HEADER = "X-Bobshell-Cred"`)
	assert.Contains(t, got, `local PARAM  = "key"`)
	assert.Contains(t, got, "local function urlencode")
	assert.Contains(t, got, "cred = urlencode(cred)")
}

func TestRenderEnvoyBootstrap_HeaderOnlyChainSkipsLua(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "envoy.filters.http.lua")
	assert.Contains(t, got, "header: Authorization")
}

func TestRenderEnvoyBootstrap_HostileValuesEscapedNotInjected(t *testing.T) {
	const hostile = "evil.example.com\"]}\ninjected_key: pwned #"
	const hostileHeader = "X-Evil\": pwned\n"
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		queryParamChain("platform-cred-x", hostile, hostileHeader, "key"),
	})
	require.NoError(t, err)

	doc := mustParseBootstrap(t, got)

	assert.NotContains(t, doc, "injected_key")

	var matched map[string]any
	for _, fc := range internalFilterChains(t, doc) {
		m, _ := fc["filter_chain_match"].(map[string]any)
		if sn, _ := m["server_names"].([]any); len(sn) == 1 && sn[0] == hostile {
			matched = fc
		}
	}
	require.NotNil(t, matched, "hostile host must round-trip intact as the SNI match value")

	assert.Contains(t, got, "injected_key", "sanity: the hostile bytes are present somewhere (as escaped scalar data)")
}

func TestRenderEnvoyBootstrap_TwoCredentialsOnSameHostStackInOneChain(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		twoCredentialChain("platform-cred-header", "platform-cred-query", "prod.ibm-bob-staging.cloud.ibm.com"),
	})
	require.NoError(t, err)

	injectorHeaders := strings.Count(got, "header: Authorization")
	assert.Equal(t, 1, injectorHeaders, "header-injection credential renders one Authorization injector")
	assert.Contains(t, got, "header: X-Internal-Query-platform-cred-query")

	doc := mustParseBootstrap(t, got)
	assert.NotNil(t, filterChainNamed(t, doc, "terminate_chain_platform-cred-header"))
	assert.Len(t, internalFilterChains(t, doc), 2, "one terminating chain + the L4 catch-all")

	luaCount := strings.Count(got, "envoy.filters.http.lua")
	assert.Equal(t, 1, luaCount)

	assert.Equal(t, 1, countClustersWithPrefix(t, doc, "upstream_platform-cred-header"))
}

func TestChainsFromSecrets_MergesSameHostIntoOneChain(t *testing.T) {
	hdr := ownerSecret("platform-conn-aaa-header", "connection", "conn-a")
	delete(hdr.Annotations, envoyHostPatternAnn)
	hdr.Annotations[envoyInjectionHostsAnn] = `[{"host":"bob.example.com","headerName":"Authorization"}]`
	hdr = withHostSDS(hdr, "bob.example.com")

	qry := ownerSecret("platform-conn-bbb-query", "connection", "conn-b")
	delete(qry.Annotations, envoyHostPatternAnn)
	qry.Annotations[envoyInjectionHostsAnn] = `[{"host":"bob.example.com","headerName":"X-Query-Cred","queryParamName":"key"}]`
	qry = withHostSDS(qry, "bob.example.com")

	chains := chainsFromSecrets([]corev1.Secret{hdr, qry}, nil)
	require.Len(t, chains, 1)
	require.Len(t, chains[0].Credentials, 2)
	assert.Equal(t, "bob.example.com", chains[0].Host)
	assert.Equal(t, "Authorization", chains[0].Credentials[0].HeaderName)
	assert.Equal(t, "X-Query-Cred", chains[0].Credentials[1].HeaderName)
	assert.Equal(t, "key", chains[0].Credentials[1].QueryParamName)
}

func TestChainsFromSecrets_DuplicateHeaderOnSameHostKeepsLexFirst(t *testing.T) {
	first := ownerSecret("platform-conn-a-first", "connection", "conn-a")
	delete(first.Annotations, envoyHostPatternAnn)
	first.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.example.com","headerName":"Authorization"}]`
	first = withHostSDS(first, "api.example.com")

	second := ownerSecret("platform-conn-b-second", "connection", "conn-b")
	delete(second.Annotations, envoyHostPatternAnn)
	second.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.example.com","headerName":"Authorization"}]`
	second = withHostSDS(second, "api.example.com")

	chains := chainsFromSecrets([]corev1.Secret{first, second}, nil)
	require.Len(t, chains, 1)
	require.Len(t, chains[0].Credentials, 1)
	assert.Equal(t, first.Name, chains[0].Credentials[0].SecretName)
}

func TestChainsFromSecrets_AllowOnlySecretRendersUncredentialedChain(t *testing.T) {
	allowOnly := ownerSecret("platform-allow-only-npm", envoySecretTypeAllowOnly, "")
	allowOnly.Annotations[envoyHostPatternAnn] = "registry.npmjs.org"

	chains := chainsFromSecrets([]corev1.Secret{allowOnly}, nil)
	require.Len(t, chains, 1)
	assert.Equal(t, "registry.npmjs.org", chains[0].Host)
	assert.Empty(t, chains[0].Credentials)
	assert.False(t, chains[0].Credentialed())
}

func TestChainsFromSecrets_L7HostsRenderUncredentialedChains(t *testing.T) {
	chains := chainsFromSecrets(nil, []string{"api.github.com"})
	require.Len(t, chains, 1)
	assert.Equal(t, "api.github.com", chains[0].Host)
	assert.Empty(t, chains[0].Credentials)
	assert.False(t, chains[0].Credentialed())
}

func TestChainsFromSecrets_L7HostDedupesAgainstCredentialedChain(t *testing.T) {
	cred := ownerSecret("platform-conn-a", "connection", "conn-a")
	delete(cred.Annotations, envoyHostPatternAnn)
	cred.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.example.com","headerName":"Authorization"}]`
	cred = withHostSDS(cred, "api.example.com")

	chains := chainsFromSecrets([]corev1.Secret{cred}, []string{"api.example.com", "api.other.com"})
	require.Len(t, chains, 2)
	assert.Equal(t, "api.example.com", chains[0].Host)
	assert.True(t, chains[0].Credentialed())
	assert.Equal(t, "api.other.com", chains[1].Host)
	assert.False(t, chains[1].Credentialed())
}

func TestEnvoySecretsRev_L7HostsRollExistingPods(t *testing.T) {
	assert.NotEqual(t, envoySecretsRev(nil, nil), envoySecretsRev(nil, []string{"api.github.com"}))
	assert.Equal(t,
		envoySecretsRev(nil, []string{"a.example.com", "b.example.com"}),
		envoySecretsRev(nil, []string{"b.example.com", "a.example.com"}))
}

func TestChainsFromSecrets_AllowOnlyAndCredentialedOnSameHost(t *testing.T) {
	cred := ownerSecret("platform-conn-a", "connection", "conn-a")
	delete(cred.Annotations, envoyHostPatternAnn)
	cred.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.example.com","headerName":"Authorization"}]`
	cred = withHostSDS(cred, "api.example.com")

	allowOnly := ownerSecret("platform-allow-only-b", envoySecretTypeAllowOnly, "")
	allowOnly.Annotations[envoyHostPatternAnn] = "api.example.com"

	chains := chainsFromSecrets([]corev1.Secret{cred, allowOnly}, nil)
	require.Len(t, chains, 1)
	require.Len(t, chains[0].Credentials, 1)
	assert.Equal(t, cred.Name, chains[0].Credentials[0].SecretName)
	assert.True(t, chains[0].Credentialed())
}

func TestEnvoySecretsRev_QueryParamAnnotationRollsExistingPods(t *testing.T) {
	plain := ownerSecret("platform-cred-bob", "generic", "")
	plain.Annotations[envoyHeaderNameAnn] = "X-Bobshell-Credential"

	withParam := ownerSecret("platform-cred-bob", "generic", "")
	withParam.Annotations[envoyHeaderNameAnn] = "X-Bobshell-Credential"
	withParam.Annotations[envoyQueryParamAnn] = "key"

	assert.NotEqual(t, envoySecretsRev([]corev1.Secret{plain}, nil), envoySecretsRev([]corev1.Secret{withParam}, nil))
}

func TestEnvoySecretsRev_InjectionHostsAnnotationRollsExistingPods(t *testing.T) {
	before := ownerSecret("platform-conn-github", "connection", "github")
	before.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`

	after := ownerSecret("platform-conn-github", "connection", "github")
	after.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com"},
		{"host":"github.com","valueFormat":"Basic {value}","encoding":"basic-x-access-token"},
		{"host":"raw.githubusercontent.com"}
	]`

	assert.NotEqual(t,
		envoySecretsRev([]corev1.Secret{before}, nil),
		envoySecretsRev([]corev1.Secret{after}, nil),
		"host-list edits must change the rev so the StatefulSet rolls",
	)
}

func TestEnvoySecretsRev_SDSDataKeysRollExistingPods(t *testing.T) {
	missing := ownerSecret("platform-conn-github", "connection", "github")
	missing.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`
	missing.Data = map[string][]byte{"access_token": []byte("gho_abc")}

	healed := ownerSecret("platform-conn-github", "connection", "github")
	healed.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com"}]`
	healed.Data = map[string][]byte{"access_token": []byte("gho_abc")}
	healed = withHostSDS(healed, "api.github.com")

	assert.NotEqual(t,
		envoySecretsRev([]corev1.Secret{missing}, nil),
		envoySecretsRev([]corev1.Secret{healed}, nil),
		"SDS data-key changes must change the rev so the StatefulSet rolls",
	)
}

func TestEnvoySecretsRev_TemplateRevBumpRollsExistingPods(t *testing.T) {
	rev := envoySecretsRev(nil, nil)
	assert.NotEqual(t, "empty", rev, "secrets-rev must not be a stable sentinel for empty Secret sets — bumping the template rev must change the hash")
	assert.NotEmpty(t, rev)

	one := envoySecretsRev([]corev1.Secret{ownerSecret("platform-conn-github", "connection", "github")}, nil)
	two := envoySecretsRev([]corev1.Secret{ownerSecret("platform-conn-slack", "connection", "slack")}, nil)
	assert.NotEqual(t, one, two)
}

func TestCredentialEnvVars_RespectsEnvMappingsAnnotation(t *testing.T) {
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

func TestCredentialEnvVars_MalformedAnnotationContributesNothing(t *testing.T) {
	broken := ownerSecret("platform-conn-broken", "connection", "broken")
	broken.Annotations[envoyEnvMappingsAnn] = "not json"

	ok := ownerSecret("platform-conn-ok", "connection", "ok")
	ok.Annotations[envoyEnvMappingsAnn] = `[{"envName":"FOO","placeholder":"ph"}]`

	envs := credentialEnvVars([]corev1.Secret{broken, ok})

	require.Len(t, envs, 1)
	assert.Equal(t, "FOO", envs[0].Name)
}

func http2CredentialedChain(secretName, host string) envoyHostChain {
	c := credentialedChain(secretName, host)
	c.HTTP2 = true
	return c
}

func TestRenderEnvoyBootstrap_HTTP2ChainAdvertisesH2AndMirrorsUpstream(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		http2CredentialedChain("platform-cred-modal-id", "api.modal.com"),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "alpn_protocols")
	assert.Contains(t, got, "- h2")
	assert.Contains(t, got, "use_downstream_protocol_config")
	assert.Contains(t, got, "HttpProtocolOptions")
}

func TestRenderEnvoyBootstrap_RestChainStaysHTTP1(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "alpn_protocols")
	assert.NotContains(t, got, "use_downstream_protocol_config")
}

func TestChainsFromSecrets_ConnectionEntryHTTP2MarksChain(t *testing.T) {
	s := ownerSecret("platform-conn-modal", "connection", "modal")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.modal.com","headerName":"x-modal-token-id","http2":true}
	]`
	s = withHostSDS(s, "api.modal.com")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 1)
	assert.True(t, chains[0].HTTP2, "injection-hosts http2:true must mark the chain")
}

func otelCfg(otlpEndpoint string) *config.Config {
	c := *bootstrapTestCfg
	c.OTelEnv = map[string]string{}
	if otlpEndpoint != "" {
		c.OTelEnv["OTEL_EXPORTER_OTLP_ENDPOINT"] = otlpEndpoint
	}
	return &c
}

func otelCfgEnv(env map[string]string) *config.Config {
	c := *bootstrapTestCfg
	c.OTelEnv = env
	return &c
}

const testOTLPEndpoint = "http://otel-collector.platform.svc.cluster.local:4317"

func TestRenderEnvoyBootstrap_TelemetryOffWithoutEndpoint(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "OpenTelemetryConfig")
	assert.NotContains(t, got, "access_log")
	assert.NotContains(t, got, "stats_sinks")
	assert.NotContains(t, got, "otel_export")
}

func TestRenderEnvoyBootstrap_TelemetryAllSignals(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfg(testOTLPEndpoint), []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "type.googleapis.com/envoy.config.trace.v3.OpenTelemetryConfig")
	assert.Contains(t, got, "service_name: platform-agent-gateway")
	assert.Contains(t, got, "resource_detectors")

	assert.Contains(t, otelTracerBlock(got), "grpc_service")
	assert.NotContains(t, otelTracerBlock(got), "http_service")

	assert.Regexp(t, `random_sampling:\s*\n\s*value: 100\n`, got)

	assert.Contains(t, got, "stats_sinks")
	assert.Contains(t, got, "envoy.stat_sinks.open_telemetry")

	doc := mustParseBootstrap(t, got)
	assert.NotNil(t, clusterNamed(t, doc, "otel_export"))
	assert.Contains(t, got, "address: otel-collector.platform.svc.cluster.local")
	assert.Contains(t, got, "port_value: 4317")

	assert.Contains(t, got, "envoy.access_loggers.file")
	assert.Contains(t, got, "envoy.access_loggers.open_telemetry")
	assert.Contains(t, got, "%REQ_WITHOUT_QUERY(:PATH)%")
}

func TestRenderEnvoyBootstrap_HTTPProtocol(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfgEnv(map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel.platform.svc:4318",
		"OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
	}), nil)
	require.NoError(t, err)
	tracer := otelTracerBlock(got)
	assert.Contains(t, tracer, "http_service")
	assert.Contains(t, tracer, "uri: http://otel.platform.svc:4318/v1/traces")
	assert.NotContains(t, tracer, "grpc_service")
	assert.NotContains(t, got, "stats_sinks")
	assert.Contains(t, got, "envoy.access_loggers.open_telemetry")
	assert.Contains(t, got, "uri: http://otel.platform.svc:4318/v1/logs")
	doc := mustParseBootstrap(t, got)
	cluster := clusterNamed(t, doc, "otel_export")
	require.NotNil(t, cluster)
	clusterYAML, err := yaml.Marshal(cluster)
	require.NoError(t, err)
	assert.NotContains(t, string(clusterYAML), "http2_protocol_options")
}

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
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfgEnv(map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": testOTLPEndpoint,
		"OTEL_TRACES_SAMPLER":         "parentbased_traceidratio",
		"OTEL_TRACES_SAMPLER_ARG":     "0.1",
	}), nil)
	require.NoError(t, err)
	assert.Regexp(t, `random_sampling:\s*\n\s*value: 10\n`, got)
}

func TestRenderEnvoyBootstrap_PlaintextCollectorNoUpstreamTLS(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfg("http://otel:4317"), nil)
	require.NoError(t, err)
	cluster := clusterNamed(t, mustParseBootstrap(t, got), "otel_export")
	require.NotNil(t, cluster)
	assert.NotContains(t, cluster, "transport_socket", "plaintext collector must have no upstream TLS")
}

func TestRenderEnvoyBootstrap_HTTPSCollectorGetsUpstreamTLS(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfg("https://otel.example.com:4318"), nil)
	require.NoError(t, err)
	assert.Contains(t, got, "address: otel.example.com")
	assert.Contains(t, got, "port_value: 4318")
	cluster := clusterNamed(t, mustParseBootstrap(t, got), "otel_export")
	require.NotNil(t, cluster)
	clusterYAML, err := yaml.Marshal(cluster)
	require.NoError(t, err)
	assert.Contains(t, string(clusterYAML), "UpstreamTlsContext")
	assert.Contains(t, string(clusterYAML), "sni: otel.example.com")
}

func TestRenderEnvoyBootstrap_TracingOnHeaderCredentialChains(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfg(testOTLPEndpoint), []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
		credentialedChain("platform-conn-anthropic", "api.anthropic.com"),
	})
	require.NoError(t, err)
	assert.Equal(t, 3, strings.Count(got, "OpenTelemetryConfig"),
		"tracing provider must be on the outer egress HCM and each header-credential chain")
	assert.Equal(t, 2, strings.Count(got, "max_path_tag_length: 1\n"),
		"each traced chain suppresses the path tag")
	assert.Equal(t, 1, strings.Count(got, "max_path_tag_length: 256\n"),
		"outer egress HCM keeps its path tag")
}

func TestRenderEnvoyBootstrap_TracingNotOnQueryParamChains(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfg(testOTLPEndpoint), []envoyHostChain{
		queryParamChain("platform-cred-q", "api.example.com", "X-Key", "key"),
	})
	require.NoError(t, err)
	assert.Equal(t, 1, strings.Count(got, "OpenTelemetryConfig"),
		"query-param chains must stay untraced")
}

func TestRenderEnvoyBootstrap_AccessLogNeverLogsCredentials(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfg(testOTLPEndpoint), []envoyHostChain{
		queryParamChain("platform-cred-q", "api.example.com", "X-Key", "key"),
	})
	require.NoError(t, err)
	assert.Contains(t, got, "%REQ_WITHOUT_QUERY(:PATH)%")
	assert.NotContains(t, got, "%REQ(:PATH)%")
	assert.NotContains(t, strings.ToLower(got), "req(authorization)")
}

func TestRenderEnvoyBootstrap_ExternalEgressStripsTraceContext(t *testing.T) {
	got, err := renderEnvoyBootstrap("agent-7", "", otelCfg(testOTLPEndpoint), nil)
	require.NoError(t, err)
	assert.Regexp(t, `request_headers_to_remove:\s*\n\s*-\s*traceparent\s*\n\s*-\s*tracestate`, got)
}

func TestEnvoyContainer_RelaysOTelEnvWithGatewayIdentity(t *testing.T) {
	cfg := *bootstrapTestCfg
	cfg.OTelEnv = map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel:4317",
		"OTEL_TRACES_SAMPLER":         "parentbased_always_on",
		"OTEL_SERVICE_NAME":           "platform-controller",
		"OTEL_RESOURCE_ATTRIBUTES":    "k8s.pod.name=controller-0",
		"OTEL_EXPORTER_OTLP_HEADERS":  "Authorization=Bearer secret",
	}
	env := map[string]string{}
	for _, e := range envoyContainer("agent-7", &cfg, nil, nil).Env {
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
	assert.Empty(t, envoyContainer("agent-7", bootstrapTestCfg, nil, nil).Env)
}

func TestRenderEnvoyBootstrap_TransitAndOTelCoexist(t *testing.T) {
	cfg := telemetryTestCfg()
	cfg.OTelEnv = map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://platform-clickstack-collector.platform.svc.cluster.local:4317",
	}
	got, err := renderEnvoyBootstrap("agent-7", "", cfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)

	var doc map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(got), &doc), "rendered bootstrap must be valid YAML")

	assert.NotNil(t, filterChainNamed(t, doc, "terminate_otel_collector"))
	assert.Contains(t, got, "OpenTelemetryConfig")
	assert.Contains(t, got, "stats_sinks")

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
	cfg := otelCfg(testOTLPEndpoint)
	assert.False(t, hasVolumeNamed(envoyVolumes("inst-1", cfg, nil, nil), envoyLeafTLSVolume))
	assert.False(t, hasMountNamed(envoyContainer("inst-1", cfg, nil, nil).VolumeMounts, envoyLeafTLSVolume))
}

func TestRenderEnvoyBootstrap_CollectorConnectNotTraced(t *testing.T) {
	cfg := telemetryTestCfg()
	cfg.OTelEnv = map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": testOTLPEndpoint}
	got, err := renderEnvoyBootstrap("agent-7", "", cfg, nil)
	require.NoError(t, err)
	assert.Contains(t, got, "exact: platform-clickstack-collector.platform.svc.cluster.local:4318")
	assert.Regexp(t, `tracing:\s*\n\s*overall_sampling:\s*\n\s*numerator: 0\n\s*random_sampling:\s*\n\s*numerator: 0`, got)

	got, err = renderEnvoyBootstrap("agent-7", "", telemetryTestCfg(), nil)
	require.NoError(t, err)
	assert.NotContains(t, got, "numerator: 0")
}

func TestRenderEnvoyBootstrap_TransitChainErrorOnlyAccessLog(t *testing.T) {
	cfg := telemetryTestCfg()
	cfg.OTelEnv = map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": testOTLPEndpoint}
	got, err := renderEnvoyBootstrap("agent-7", "", cfg, nil)
	require.NoError(t, err)
	chain := filterChainNamed(t, mustParseBootstrap(t, got), "terminate_otel_collector")
	require.NotNil(t, chain)
	chainYAML, err := yaml.Marshal(chain)
	require.NoError(t, err)
	assert.Contains(t, string(chainYAML), "access_log")
	assert.Contains(t, string(chainYAML), "status_code_filter")
	assert.Contains(t, string(chainYAML), "response_flag_filter")

	got, err = renderEnvoyBootstrap("agent-7", "", telemetryTestCfg(), nil)
	require.NoError(t, err)
	chain = filterChainNamed(t, mustParseBootstrap(t, got), "terminate_otel_collector")
	require.NotNil(t, chain)
	chainYAML, err = yaml.Marshal(chain)
	require.NoError(t, err)
	assert.NotContains(t, string(chainYAML), "access_log")
}

func TestRenderEnvoyBootstrap_GatewayOverrideDecouplesFromControllerEnv(t *testing.T) {
	cfg := *bootstrapTestCfg
	cfg.OTelEnv = map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.platform.svc:4318",
		"OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
	}
	cfg.GatewayOTLPEndpoint = "http://collector.platform.svc:4317"
	cfg.GatewayOTLPProtocol = "grpc"
	got, err := renderEnvoyBootstrap("agent-7", "", &cfg, nil)
	require.NoError(t, err)

	assert.Contains(t, got, "stats_sinks", "gRPC override must enable the stats sink")
	assert.Contains(t, otelTracerBlock(got), "grpc_service")
	assert.Contains(t, got, "envoy.access_loggers.open_telemetry")
	assert.NotContains(t, got, "/v1/traces", "no OTLP/HTTP branch may render under the gRPC override")
	assert.Contains(t, got, "port_value: 4317")

	env := map[string]string{}
	for _, e := range envoyContainer("agent-7", &cfg, nil, nil).Env {
		env[e.Name] = e.Value
	}
	assert.Equal(t, "http://collector.platform.svc:4317", env["OTEL_EXPORTER_OTLP_ENDPOINT"])
	assert.Equal(t, "grpc", env["OTEL_EXPORTER_OTLP_PROTOCOL"])
}

func TestChainsFromSecrets_ConnectionEntryPortUpgradesCA(t *testing.T) {
	s := ownerSecret("platform-conn-k8s", "connection", "k8s")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.cluster.example","headerName":"Authorization","port":6443,"upgrades":true,"caKey":"upstream-ca.crt"}
	]`
	s = withHostSDS(s, "api.cluster.example")
	s.Data["upstream-ca.crt"] = []byte("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 1)
	assert.Equal(t, 6443, chains[0].UpstreamPortValue())
	assert.True(t, chains[0].Upgrades)
	assert.Equal(t,
		"/etc/envoy/credentials/cred-platform-conn-k8s/upstream-ca.crt",
		chains[0].UpstreamCAFile)
	assert.Equal(t, "api.cluster.example:6443", chains[0].HostRewrite())
}

func TestChainsFromSecrets_MissingCADataKeyDegradesToSystemTrust(t *testing.T) {
	s := ownerSecret("platform-conn-k8s", "connection", "k8s")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.cluster.example","headerName":"Authorization","port":6443,"caKey":"upstream-ca.crt"}
	]`
	s = withHostSDS(s, "api.cluster.example")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 1)
	assert.Empty(t, chains[0].UpstreamCAFile,
		"missing CA data key must degrade to system trust, not reference an absent file")
	assert.Equal(t, 6443, chains[0].UpstreamPortValue(), "other opts unaffected")
}

func TestChainsFromSecrets_PortDefaultsTo443AndBareHostRewrite(t *testing.T) {
	s := ownerSecret("platform-conn-github", "connection", "github")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.github.com","headerName":"Authorization"}
	]`
	s = withHostSDS(s, "api.github.com")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 1)
	assert.Equal(t, 443, chains[0].UpstreamPortValue())
	assert.False(t, chains[0].Upgrades)
	assert.Empty(t, chains[0].UpstreamCAFile)
	assert.Equal(t, "api.github.com", chains[0].HostRewrite())
}

func TestChainsFromSecrets_ConflictingPortsKeepFirst(t *testing.T) {
	a := ownerSecret("platform-conn-aaa", "connection", "aaa")
	delete(a.Annotations, envoyHostPatternAnn)
	a.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.cluster.example","headerName":"Authorization","port":6443}
	]`
	a = withHostSDS(a, "api.cluster.example")
	b := ownerSecret("platform-conn-bbb", "connection", "bbb")
	delete(b.Annotations, envoyHostPatternAnn)
	b.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.cluster.example","headerName":"X-Other","port":8443}
	]`
	b = withHostSDS(b, "api.cluster.example")

	chains := chainsFromSecrets([]corev1.Secret{a, b}, nil)
	require.Len(t, chains, 1)
	assert.Equal(t, 6443, chains[0].UpstreamPortValue(),
		"name-sorted first secret's port must win on conflict")
}

func TestChainsFromSecrets_TraversalCAKeyIgnored(t *testing.T) {
	s := ownerSecret("platform-conn-k8s", "connection", "k8s")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = `[
		{"host":"api.cluster.example","headerName":"Authorization","caKey":"../../tls/tls.key"}
	]`
	s = withHostSDS(s, "api.cluster.example")

	chains := chainsFromSecrets([]corev1.Secret{s}, nil)
	require.Len(t, chains, 1)
	assert.Empty(t, chains[0].UpstreamCAFile,
		"caKey with path separators must not escape the Secret mount")
}

func portUpgradesChain(secretName, host string, port int, caFile string) envoyHostChain {
	c := credentialedChain(secretName, host)
	c.UpstreamPort = port
	c.Upgrades = true
	c.UpstreamCAFile = caFile
	return c
}

func TestRenderEnvoyBootstrap_PortChainPinsUpstreamAndRewritesAuthority(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		portUpgradesChain("platform-conn-k8s", "api.cluster.example", 6443, ""),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "port_value: 6443")
	assert.Contains(t, got, "host_rewrite_literal: api.cluster.example:6443")
	assert.Regexp(t, `match_typed_subject_alt_names:\s*\n\s*-\s*matcher:\s*\n\s*exact:\s*api\.cluster\.example\s*\n\s*san_type:\s*DNS`, got)
}

func TestRenderEnvoyBootstrap_UpgradesChainTunnelsWebsocketAndSpdy(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		portUpgradesChain("platform-conn-k8s", "api.cluster.example", 6443, ""),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "upgrade_type: spdy/3.1")
	assert.Equal(t, 2, strings.Count(got, "idle_timeout: 14400s"),
		"idle_timeout must cover both the inner chain and the outer CONNECT tunnel")
}

func TestRenderEnvoyBootstrap_NonUpgradesChainOmitsTunneling(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	assert.NotContains(t, got, "spdy/3.1")
	assert.NotContains(t, got, "idle_timeout: 14400s")
}

func TestRenderEnvoyBootstrap_UpstreamCAFileReplacesSystemBundle(t *testing.T) {
	caFile := "/etc/envoy/credentials/cred-platform-conn-k8s/upstream-ca.crt"
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		portUpgradesChain("platform-conn-k8s", "api.cluster.example", 6443, caFile),
	})
	require.NoError(t, err)

	assert.Contains(t, got, "filename: "+caFile)
	assert.Regexp(t, `match_typed_subject_alt_names:\s*\n\s*-\s*matcher:\s*\n\s*exact:\s*api\.cluster\.example\s*\n\s*san_type:\s*DNS`, got)
}

func TestRenderEnvoyBootstrap_PortUpgradesCARendersValidYAML(t *testing.T) {
	got, err := renderEnvoyBootstrap("inst-1", "", bootstrapTestCfg, []envoyHostChain{
		portUpgradesChain("platform-conn-k8s", "api.cluster.example", 6443,
			"/etc/envoy/credentials/cred-platform-conn-k8s/upstream-ca.crt"),
		credentialedChain("platform-conn-github", "api.github.com"),
	})
	require.NoError(t, err)
	var doc map[string]any
	require.NoError(t, yaml.Unmarshal([]byte(got), &doc), "rendered bootstrap must be valid YAML")
}
