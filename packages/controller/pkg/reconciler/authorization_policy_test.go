package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ADR-041 + ADR-027: per-fork harness policy admits the fork SA only to
// `/api/agents/<parent>/mcp` — NOT the parent's full
// `/api/agents/<parent>/*` surface. This is the credential boundary
// for forks: a compromised fork cannot reach pod-files SSE,
// `/internal/trigger`, or any future per-instance harness endpoint
// scoped to the parent.
func TestBuildForkHarnessAuthorizationPolicy_NarrowToMcp(t *testing.T) {
	p := BuildForkHarnessAuthorizationPolicy("fork-abc", "parent-instance", testConfig, testOwnerCM.Namespace, configMapOwnerRef(testOwnerCM))

	assert.Equal(t, "fork-abc-harness-allow", p.GetName())
	assert.Equal(t, testConfig.ReleaseNamespace, p.GetNamespace())

	spec, _ := p.Object["spec"].(map[string]interface{})
	rules, _ := spec["rules"].([]interface{})
	rule0, _ := rules[0].(map[string]interface{})

	from, _ := rule0["from"].([]interface{})
	source, _ := from[0].(map[string]interface{})["source"].(map[string]interface{})
	principals, _ := source["principals"].([]interface{})
	assert.Equal(t, testConfig.PrincipalFor("fork-abc"), principals[0],
		"fork-harness policy admits the FORK's SA, not the parent's")

	to, _ := rule0["to"].([]interface{})
	op, _ := to[0].(map[string]interface{})["operation"].(map[string]interface{})
	paths, _ := op["paths"].([]interface{})
	require.Len(t, paths, 1)
	assert.Equal(t, "/api/agents/parent-instance/mcp", paths[0],
		"fork must reach ONLY the parent's MCP endpoint — not pod-files, not /internal/trigger")
}

// ADR-041 + ADR-027: per-fork ext-authz policy admits the fork SA to the
// PARENT's per-instance ext-authz Service. The parent owner's HITL rules
// stay the gate; the fork's gateway then injects the replier's
// credential on the wire.
func TestBuildForkExtAuthzAuthorizationPolicy_TargetsParentService(t *testing.T) {
	p := BuildForkExtAuthzAuthorizationPolicy("fork-abc", "parent-instance", testConfig, testOwnerCM.Namespace, configMapOwnerRef(testOwnerCM))

	assert.Equal(t, "fork-abc-extauthz-allow", p.GetName())
	assert.Equal(t, testConfig.ReleaseNamespace, p.GetNamespace())

	spec, _ := p.Object["spec"].(map[string]interface{})
	targetRefs, _ := spec["targetRefs"].([]interface{})
	tr0, _ := targetRefs[0].(map[string]interface{})
	assert.Equal(t, "Service", tr0["kind"])
	assert.Equal(t, testConfig.ExtAuthzServiceName("parent-instance"), tr0["name"],
		"fork-extauthz policy targets the PARENT's per-instance ext-authz Service")

	rules, _ := spec["rules"].([]interface{})
	rule0, _ := rules[0].(map[string]interface{})
	from, _ := rule0["from"].([]interface{})
	source, _ := from[0].(map[string]interface{})["source"].(map[string]interface{})
	principals, _ := source["principals"].([]interface{})
	assert.Equal(t, testConfig.PrincipalFor("fork-abc"), principals[0],
		"fork-extauthz policy admits the FORK's SA, not the parent's")
}

// ADR-041: harness policy targets the api-server's waypoint Gateway via
// targetRefs (Gateway-API CRD), ALLOWs the SA principal to a path-prefix
// keyed on the URL `:id`. Lives in the release ns alongside the waypoint.
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

// ADR-041: ext-authz policy targets the per-instance ext-authz Service
// (one per instance, named via cfg.ExtAuthzServiceName), ALLOWs only the
// matching SA principal — no header check, no host match needed since
// the Service itself is per-instance.
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
}
