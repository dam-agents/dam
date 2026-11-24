package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// TEST_OVERVIEW: web search control on the gateway. An agent whose owner turns it on has every metered model-provider chain send the whole request body to the ext_authz check, so the api-server can hold a Messages call that declares a web search tool. The body is read whole or not at all: a body over the limit is refused at the gateway, never checked in part. An agent with control off renders exactly what it rendered before, and only toggling the choice rolls that agent's gateway.

func providerSecret(t *testing.T) corev1.Secret {
	t.Helper()
	s := ownerSecret("platform-conn-litellm", "connection", "conn-litellm")
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoySecretPurposeAnn] = "connection:ibm-litellm"
	s.Annotations[envoyInjectionHostsAnn] = `[{"host":"llm.example.com","headerName":"Authorization","valueFormat":"Bearer {value}"}]`
	return withHostSDS(s, "llm.example.com")
}

func githubSecret() corev1.Secret {
	s := withHostSDS(ownerSecret("platform-conn-gh", "connection", "gh"), "api.github.com")
	s.Annotations[envoyInjectionHostsAnn] = `[{"host":"api.github.com","headerName":"Authorization"}]`
	return s
}

func extAuthzConfigForHost(t *testing.T, doc map[string]any, host string) map[string]any {
	t.Helper()
	for _, f := range httpFiltersForHost(t, doc, host) {
		if f["name"] == "envoy.filters.http.ext_authz" {
			return f["typed_config"].(map[string]any)
		}
	}
	require.FailNow(t, "no ext_authz filter on "+host)
	return nil
}

func renderWithChoices(t *testing.T, choices gatewayChoices, secrets ...corev1.Secret) map[string]any {
	t.Helper()
	owner := metav1.OwnerReference{APIVersion: "v1", Kind: "ConfigMap", Name: "owner", UID: "uid"}
	cm, err := BuildEnvoyBootstrapConfigMap("inst-1", "", bootstrapTestCfg, owner, secrets, nil, choices)
	require.NoError(t, err)
	return mustParseBootstrap(t, cm.Data["envoy.yaml"])
}

// TEST_SCENARIO: with control on, the ext_authz check of a model-provider chain receives the whole body as bytes, up to the Messages API's 32 MiB, and a longer body is refused rather than sent in part; the spend metadata still reaches the same check.
func TestWebSearchControl_MeteredChainSendsTheWholeBody(t *testing.T) {
	doc := renderWithChoices(t, gatewayChoices{WebSearchControl: true}, providerSecret(t))

	cfg := extAuthzConfigForHost(t, doc, "llm.example.com")
	assert.Equal(t, map[string]any{
		"max_request_bytes":     float64(32 << 20),
		"allow_partial_message": false,
		"pack_as_bytes":         true,
	}, cfg["with_request_body"])
	assert.Equal(t, []any{spendMetadataNamespace}, cfg["metadata_context_namespaces"])
}

// TEST_SCENARIO: control reads model calls only: a chain for any other Connection keeps its bodies unread, so turning control on adds no buffering to the agent's other traffic.
func TestWebSearchControl_OtherChainsReadNoBody(t *testing.T) {
	doc := renderWithChoices(t, gatewayChoices{WebSearchControl: true}, providerSecret(t), githubSecret())

	assert.NotContains(t, extAuthzConfigForHost(t, doc, "api.github.com"), "with_request_body")
}

// TEST_SCENARIO: with control off, a model-provider chain reads no body, so an agent that never turns it on keeps its model calls as fast as before.
func TestWebSearchControl_OffReadsNoBody(t *testing.T) {
	doc := renderWithChoices(t, gatewayChoices{}, providerSecret(t))

	assert.NotContains(t, extAuthzConfigForHost(t, doc, "llm.example.com"), "with_request_body")
}

// TEST_SCENARIO: the choice is part of the gateway's revision, so turning it on or off rolls that agent's gateway, while an agent that leaves it off keeps the revision it had, and upgrading rolls nothing.
func TestWebSearchControl_TogglingRollsTheGateway(t *testing.T) {
	secrets := []corev1.Secret{providerSecret(t)}
	off := envoyGatewayRev(bootstrapTestCfg, secrets, nil, gatewayChoices{})
	on := envoyGatewayRev(bootstrapTestCfg, secrets, nil, gatewayChoices{WebSearchControl: true})

	assert.Equal(t, envoySecretsRev(secrets, nil), off)
	assert.NotEqual(t, off, on)
	assert.NotEqual(t, on, envoyGatewayRev(bootstrapTestCfg, secrets, nil, gatewayChoices{RequireAddress: true}))
}

// TEST_SCENARIO: the Agent spec is the one source of the choice, for an agent's own gateway and for its listener on an owner gateway alike.
func TestWebSearchControl_ComesFromTheAgentSpec(t *testing.T) {
	choices := gatewayChoicesOf(&apiv1.AgentSpec{WebSearchControl: true, RequireConnectionAddress: true})
	assert.Equal(t, gatewayChoices{RequireAddress: true, WebSearchControl: true}, choices)

	chains := chainsFromSecrets([]corev1.Secret{providerSecret(t)}, nil)
	choices.applyTo(chains)
	for _, c := range chains {
		assert.True(t, c.WebSearchControl)
		assert.True(t, c.RequireAddress)
	}
}

// TEST_SCENARIO: on an owner gateway, the choice changes only its own agent's listener, so its health revision moves and a sibling's stays, and the listener it renders sends the whole body.
func TestWebSearchControl_OwnerGatewayChangesOnlyItsAgent(t *testing.T) {
	agents := func(controlB bool) []ownerGatewayAgent {
		chains := func() []envoyHostChain { return chainsFromSecrets([]corev1.Secret{providerSecret(t)}, nil) }
		b := chains()
		gatewayChoices{WebSearchControl: controlB}.applyTo(b)
		return []ownerGatewayAgent{
			{Name: "agent-a", ProxyPort: 20000, Chains: chains()},
			{Name: "agent-b", ProxyPort: 20002, Chains: b},
		}
	}
	before, err := renderOwnerGateway(agents(false), bootstrapTestCfg, nil)
	require.NoError(t, err)
	after, err := renderOwnerGateway(agents(true), bootstrapTestCfg, nil)
	require.NoError(t, err)

	assert.Equal(t, before.Revisions["agent-a"], after.Revisions["agent-a"])
	assert.NotEqual(t, before.Revisions["agent-b"], after.Revisions["agent-b"])
	assert.NotContains(t, before.LDS, "with_request_body")
	assert.Contains(t, after.LDS, "with_request_body")
}
