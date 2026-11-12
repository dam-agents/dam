package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildHarnessAuthorizationPolicy_PathPrefix(t *testing.T) {
	p := BuildHarnessAuthorizationPolicy("my-instance", testConfig, testOwnerCM.Namespace, configMapOwnerRef(testOwnerCM))

	assert.Equal(t, "my-instance-harness-allow", p.GetName())
	assert.Equal(t, testConfig.ReleaseNamespace, p.GetNamespace())

	spec, _ := p.Object["spec"].(map[string]interface{})
	targetRefs, _ := spec["targetRefs"].([]interface{})
	require.Len(t, targetRefs, 1)
	tr0, _ := targetRefs[0].(map[string]interface{})
	assert.Equal(t, "gateway.networking.k8s.io", tr0["group"])
	assert.Equal(t, "Gateway", tr0["kind"])
	assert.Equal(t, testConfig.IstioWaypointName, tr0["name"])

	rules, _ := spec["rules"].([]interface{})
	rule0, _ := rules[0].(map[string]interface{})
	to, _ := rule0["to"].([]interface{})
	op, _ := to[0].(map[string]interface{})["operation"].(map[string]interface{})
	paths, _ := op["paths"].([]interface{})
	assert.Equal(t, "/api/agents/my-instance/*", paths[0],
		"harness policy must scope to /api/agents/<id>/* — the URL :id is the SPIFFE-bound identity")
}

func TestBuildExtAuthzAuthorizationPolicy_TargetsService(t *testing.T) {
	p := BuildExtAuthzAuthorizationPolicy("my-instance", testConfig, testOwnerCM.Namespace, configMapOwnerRef(testOwnerCM))

	assert.Equal(t, "my-instance-extauthz-allow", p.GetName())
	assert.Equal(t, testConfig.ReleaseNamespace, p.GetNamespace())

	spec, _ := p.Object["spec"].(map[string]interface{})
	targetRefs, _ := spec["targetRefs"].([]interface{})
	tr0, _ := targetRefs[0].(map[string]interface{})
	assert.Equal(t, "Service", tr0["kind"])
	assert.Equal(t, testConfig.ExtAuthzServiceName("my-instance"), tr0["name"])

	rules, _ := spec["rules"].([]interface{})
	rule0, _ := rules[0].(map[string]interface{})
	from, _ := rule0["from"].([]interface{})
	source, _ := from[0].(map[string]interface{})["source"].(map[string]interface{})
	principals, _ := source["principals"].([]interface{})
	assert.Equal(t, testConfig.PrincipalFor("my-instance"), principals[0])

	to, _ := rule0["to"].([]interface{})
	require.Len(t, to, 1)
	op, _ := to[0].(map[string]interface{})["operation"].(map[string]interface{})
	host := testConfig.ExtAuthzHostFor("my-instance")
	assert.Equal(t, []interface{}{host, host + ":*"}, op["hosts"],
		"the admitted principal must also name this agent's own authority, or it can ask as another agent")
}

// TEST_SCENARIO: an owner gateway's principal is shared by every vm Agent of the owner, so at the harness it is admitted for one agent only on that agent's paths and only with that agent named in the guard's header; the agent's own principal keeps its rule unchanged while both gateways exist.
func TestOwnerGatewayPrincipal_AdmittedOnlyForTheGuardedAgent(t *testing.T) {
	p := BuildHarnessAuthorizationPolicy("agent-a", testConfig, testOwnerCM.Namespace, configMapOwnerRef(testOwnerCM))
	admitOwnerGateway(p, "agent-a", testConfig, "td/ns/agents/sa/owner-gw", true)
	rules := p.Object["spec"].(map[string]interface{})["rules"].([]interface{})
	require.Len(t, rules, 2)
	owner := rules[1].(map[string]interface{})
	assert.Equal(t, []interface{}{"td/ns/agents/sa/owner-gw"}, owner["from"].([]interface{})[0].(map[string]interface{})["source"].(map[string]interface{})["principals"])
	assert.Equal(t, []interface{}{"/api/agents/agent-a/*"}, owner["to"].([]interface{})[0].(map[string]interface{})["operation"].(map[string]interface{})["paths"])
	when := owner["when"].([]interface{})[0].(map[string]interface{})
	assert.Equal(t, "request.headers["+harnessGuardHeader+"]", when["key"])
	assert.Equal(t, []interface{}{"agent-a"}, when["values"])

	e := BuildExtAuthzAuthorizationPolicy("agent-a", testConfig, testOwnerCM.Namespace, configMapOwnerRef(testOwnerCM))
	admitOwnerGateway(e, "agent-a", testConfig, "td/ns/agents/sa/owner-gw", false)
	erules := e.Object["spec"].(map[string]interface{})["rules"].([]interface{})
	require.Len(t, erules, 2)
	ownerExtAuthz := erules[1].(map[string]interface{})
	assert.NotContains(t, ownerExtAuthz, "when")
	host := testConfig.ExtAuthzHostFor("agent-a")
	to, _ := ownerExtAuthz["to"].([]interface{})
	require.Len(t, to, 1)
	hosts, _ := to[0].(map[string]interface{})["operation"].(map[string]interface{})["hosts"]
	assert.Equal(t, []interface{}{host, host + ":*"}, hosts,
		"the owner principal is shared, so at ext-authz it is bound to this agent's authority as well")
}
