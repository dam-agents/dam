package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ADR-040: gateway-admission policy targets the gateway pods of this pair
// (selector matches LabelPair + LabelRole=gateway) and ALLOWs only the
// matching SA principal. For long-lived pairs pairKey == principalInstanceID;
// for forks pairKey == fork name and principalInstanceID == parent instance.
func TestBuildGatewayAuthorizationPolicy_LongLivedPair(t *testing.T) {
	p := BuildGatewayAuthorizationPolicy("my-instance", "my-instance", testConfig, testOwnerCM)

	assert.Equal(t, "my-instance-gateway-allow", p.GetName())
	assert.Equal(t, testConfig.Namespace, p.GetNamespace())

	spec, _ := p.Object["spec"].(map[string]interface{})
	require.NotNil(t, spec)
	assert.Equal(t, "ALLOW", spec["action"])

	selector, _ := spec["selector"].(map[string]interface{})
	matchLabels, _ := selector["matchLabels"].(map[string]interface{})
	assert.Equal(t, "my-instance", matchLabels[LabelPair])
	assert.Equal(t, RoleGateway, matchLabels[LabelRole])

	rules, _ := spec["rules"].([]interface{})
	require.Len(t, rules, 1)
	rule0, _ := rules[0].(map[string]interface{})
	from, _ := rule0["from"].([]interface{})
	source, _ := from[0].(map[string]interface{})["source"].(map[string]interface{})
	principals, _ := source["principals"].([]interface{})
	require.Len(t, principals, 1)
	assert.Equal(t, testConfig.PrincipalFor("my-instance"), principals[0])
}

// ADR-040: forks reuse the parent's SA. The fork's gateway-admission policy
// targets the fork pod (pairKey=forkName) but the principal it admits is
// the PARENT's, since both pods of the fork pair run as the parent's SA.
func TestBuildGatewayAuthorizationPolicy_ForkUsesParentPrincipal(t *testing.T) {
	p := BuildGatewayAuthorizationPolicy("fork-abc", "parent-instance", testConfig, testOwnerCM)
	spec, _ := p.Object["spec"].(map[string]interface{})

	selector, _ := spec["selector"].(map[string]interface{})
	matchLabels, _ := selector["matchLabels"].(map[string]interface{})
	assert.Equal(t, "fork-abc", matchLabels[LabelPair], "selector must target the fork's pair, not the parent's")

	rules, _ := spec["rules"].([]interface{})
	rule0, _ := rules[0].(map[string]interface{})
	from, _ := rule0["from"].([]interface{})
	source, _ := from[0].(map[string]interface{})["source"].(map[string]interface{})
	principals, _ := source["principals"].([]interface{})
	assert.Equal(t, testConfig.PrincipalFor("parent-instance"), principals[0],
		"fork policy must allow the parent's SA principal — forks share the parent's SA")
}

// ADR-040: harness policy targets the api-server's waypoint Gateway via
// targetRefs (Gateway-API CRD), ALLOWs the SA principal to a path-prefix
// keyed on the URL `:id`. Lives in the release ns alongside the waypoint.
func TestBuildHarnessAuthorizationPolicy_PathPrefix(t *testing.T) {
	p := BuildHarnessAuthorizationPolicy("my-instance", testConfig, testOwnerCM)

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
	assert.Equal(t, "/api/instances/my-instance/*", paths[0],
		"harness policy must scope to /api/instances/<id>/* — the URL :id is the SPIFFE-bound identity")
}

// ADR-040: ext-authz policy targets the per-instance ext-authz Service
// (one per instance, named via cfg.ExtAuthzServiceName), ALLOWs only the
// matching SA principal — no header check, no host match needed since
// the Service itself is per-instance.
func TestBuildExtAuthzAuthorizationPolicy_TargetsService(t *testing.T) {
	p := BuildExtAuthzAuthorizationPolicy("my-instance", testConfig, testOwnerCM)

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
}
