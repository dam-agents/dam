package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Harness policy targets the api-server's waypoint Gateway via
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

// Ext-authz policy targets the per-instance ext-authz Service
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
