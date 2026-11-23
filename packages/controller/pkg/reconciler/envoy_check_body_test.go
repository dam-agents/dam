package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

// TEST_OVERVIEW: a Connection can ask for its requests to be checked with their body. Its Secret says so with `checkBody` on an entry of the injection-hosts annotation. The chain of that host then sends each request's whole body to the ext_authz check, so the api-server can read what the request does before it lets it through. The body is read whole or not at all, and the check also gets the server name of the TLS session, which names the chain's real host whatever Host header the agent wrote. Every other TLS chain of that agent sends the server name too. An agent with no flagged host renders what it rendered before. The flag is part of the gateway's revision, so a gateway picks it up when it appears or goes away.

const checkedHost = "mcp.example.com"

var wholeRequestBody = map[string]any{
	"max_request_bytes":     float64(4 << 20),
	"allow_partial_message": false,
	"pack_as_bytes":         true,
}

func checkedHostEntry(checkBody bool) string {
	entry := `{"host":"` + checkedHost + `","headerName":"Authorization","valueFormat":"Bearer {value}"`
	if checkBody {
		entry += `,"checkBody":true`
	}
	return "[" + entry + "}]"
}

func checkedHostSecret(connection string, checkBody bool) corev1.Secret {
	s := ownerSecret("platform-conn-"+connection, "connection", connection)
	delete(s.Annotations, envoyHostPatternAnn)
	s.Annotations[envoyInjectionHostsAnn] = checkedHostEntry(checkBody)
	return withHostSDS(s, checkedHost)
}

// TEST_SCENARIO: a Secret entry with the flag makes its host's ext_authz check receive the whole body as bytes, up to 4 MiB, far above one tool call. A longer body is refused and never sent in part.
func TestCheckBody_FlaggedChainSendsTheWholeBody(t *testing.T) {
	doc := renderWithChoices(t, gatewayChoices{}, checkedHostSecret("mcp", true))

	assert.Equal(t, wholeRequestBody, extAuthzConfigForHost(t, doc, checkedHost)["with_request_body"])
}

// TEST_SCENARIO: the agent writes the Host header, but the chain and its credential are chosen by the TLS server name. A flagged chain sends that name with the check, so a request with a forged Host is still checked as a request to the chain's host. An unflagged chain sends what it sent before.
func TestCheckBody_FlaggedChainSendsTheServerName(t *testing.T) {
	flagged := renderWithChoices(t, gatewayChoices{}, checkedHostSecret("mcp", true))
	assert.Equal(t, true, extAuthzConfigForHost(t, flagged, checkedHost)["include_tls_session"])

	unflagged := renderWithChoices(t, gatewayChoices{}, checkedHostSecret("mcp", false))
	assert.NotContains(t, extAuthzConfigForHost(t, unflagged, checkedHost), "include_tls_session")
}

// TEST_SCENARIO: a gateway that has not restarted onto the check sends no server name, and there a forged Host could hide the checked host. So once one chain of an agent checks a body, every TLS chain of that agent sends its server name, the Environment chain included, and the api-server can refuse a request that comes without one. An agent with no checked chain renders what it rendered before.
func TestCheckBody_EveryChainOfTheAgentSendsTheServerName(t *testing.T) {
	flagged := renderWithChoices(t, gatewayChoices{}, checkedHostSecret("mcp", true), githubSecret(), agentKeySecret("agent-key", "inst-1"))
	assert.Equal(t, true, extAuthzConfigForHost(t, flagged, "api.github.com")["include_tls_session"])
	assert.Equal(t, true, extAuthzConfigForHost(t, flagged, testEnvironmentsDomain)["include_tls_session"])

	unflagged := renderWithChoices(t, gatewayChoices{}, checkedHostSecret("mcp", false), githubSecret(), agentKeySecret("agent-key", "inst-1"))
	assert.NotContains(t, extAuthzConfigForHost(t, unflagged, "api.github.com"), "include_tls_session")
	assert.NotContains(t, extAuthzConfigForHost(t, unflagged, testEnvironmentsDomain), "include_tls_session")
}

// TEST_SCENARIO: a host with no flagged entry reads no body, and a flag on one host adds no body reading to another host of the same agent.
func TestCheckBody_UnflaggedChainReadsNoBody(t *testing.T) {
	unflagged := renderWithChoices(t, gatewayChoices{}, checkedHostSecret("mcp", false))
	assert.NotContains(t, extAuthzConfigForHost(t, unflagged, checkedHost), "with_request_body")

	mixed := renderWithChoices(t, gatewayChoices{}, checkedHostSecret("mcp", true), githubSecret())
	assert.NotContains(t, extAuthzConfigForHost(t, mixed, "api.github.com"), "with_request_body")
}

// TEST_SCENARIO: two Connections share one host and only one of them has the flag. The host has one chain, so the body is checked for both, in either mount order.
func TestCheckBody_OneFlaggedSecretIsEnoughForTheHost(t *testing.T) {
	flagged, plain := checkedHostSecret("mcp-a", true), checkedHostSecret("mcp-b", false)

	for _, secrets := range [][]corev1.Secret{{flagged, plain}, {plain, flagged}} {
		doc := renderWithChoices(t, gatewayChoices{}, secrets...)
		assert.Equal(t, wholeRequestBody, extAuthzConfigForHost(t, doc, checkedHost)["with_request_body"])
	}
}

// TEST_SCENARIO: a flagged Secret that lost its SDS data key renders its host with no credential, but the chain still asks ext_authz, so it still sends the whole body.
func TestCheckBody_HostWithoutItsCredentialStillSendsTheBody(t *testing.T) {
	s := checkedHostSecret("mcp", true)
	s.Data = nil
	doc := renderWithChoices(t, gatewayChoices{}, s)

	assert.Equal(t, wholeRequestBody, extAuthzConfigForHost(t, doc, checkedHost)["with_request_body"])
}

// TEST_SCENARIO: a flagged model-provider chain sends the whole body even when the agent has web search control off, and the spend metadata still reaches the same check.
func TestCheckBody_MeteredChainSendsTheBodyWithoutWebSearchControl(t *testing.T) {
	s := providerSecret(t)
	s.Annotations[envoyInjectionHostsAnn] = `[{"host":"llm.example.com","headerName":"Authorization","valueFormat":"Bearer {value}","checkBody":true}]`
	doc := renderWithChoices(t, gatewayChoices{}, s)

	cfg := extAuthzConfigForHost(t, doc, "llm.example.com")
	assert.Equal(t, wholeRequestBody, cfg["with_request_body"])
	assert.Equal(t, []any{spendMetadataNamespace}, cfg["metadata_context_namespaces"])
}

// TEST_SCENARIO: the flag is part of the gateway's revision, so an agent's own gateway rolls when the flag appears on a Secret or goes away.
func TestCheckBody_TogglingRollsTheGateway(t *testing.T) {
	off := envoyGatewayRev(bootstrapTestCfg, []corev1.Secret{checkedHostSecret("mcp", false)}, nil, gatewayChoices{})
	on := envoyGatewayRev(bootstrapTestCfg, []corev1.Secret{checkedHostSecret("mcp", true)}, nil, gatewayChoices{})

	assert.NotEqual(t, off, on)
}

// TEST_SCENARIO: a controller from before the flag hashed the same annotation but rendered no body check. So a flagged Secret adds its own mark to the revision, and the first controller that knows the flag rolls that gateway. A Secret without the flag adds nothing, so an upgrade rolls no other gateway.
func TestCheckBody_OnlyAFlaggedSecretMarksTheRevision(t *testing.T) {
	assert.NotEmpty(t, checkBodyRevMark(checkedHostSecret("mcp", true)))
	assert.Empty(t, checkBodyRevMark(checkedHostSecret("mcp", false)))
	assert.Empty(t, checkBodyRevMark(githubSecret()))
}

// TEST_SCENARIO: on an owner gateway the flag changes only the listener of the agent that holds the Connection. That agent's health revision moves, a sibling's stays, and the new listener sends the whole body.
func TestCheckBody_OwnerGatewayChangesOnlyItsAgent(t *testing.T) {
	agents := func(checkBodyB bool) []ownerGatewayAgent {
		chains := func(checkBody bool) []envoyHostChain {
			return chainsFromSecrets([]corev1.Secret{checkedHostSecret("mcp", checkBody)}, nil)
		}
		return []ownerGatewayAgent{
			{Name: "agent-a", ProxyPort: 20000, Chains: chains(false)},
			{Name: "agent-b", ProxyPort: 20002, Chains: chains(checkBodyB)},
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
