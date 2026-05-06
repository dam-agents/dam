package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildInstanceAuthorizationPolicy(t *testing.T) {
	ap := BuildInstanceAuthorizationPolicy("my-instance", testConfig, testOwnerCM)

	// Lives next to the harness Service in the release namespace, owner-
	// refed to the instance CM so K8s GC reaps it on instance deletion.
	assert.Equal(t, "my-instance-harness", ap.GetName())
	assert.Equal(t, "default", ap.GetNamespace())
	assert.Equal(t, "my-instance", ap.GetLabels()["agent-platform.ai/instance"])
	require.Len(t, ap.GetOwnerReferences(), 1)
	assert.EqualValues(t, "cm-uid-123", ap.GetOwnerReferences()[0].UID)

	spec, ok := ap.Object["spec"].(map[string]interface{})
	require.True(t, ok, "spec must be present")

	// Targets the harness Service (so the rule applies at the waypoint).
	targetRefs := spec["targetRefs"].([]interface{})
	require.Len(t, targetRefs, 1)
	tr := targetRefs[0].(map[string]interface{})
	assert.Equal(t, "Service", tr["kind"])
	assert.Equal(t, "platform-apiserver-harness", tr["name"])

	assert.Equal(t, "ALLOW", spec["action"])

	// The single rule pins principal SA → URL `:id` path prefix. The
	// principal SA name equals the instance name (ADR-039 per-instance SA).
	rules := spec["rules"].([]interface{})
	require.Len(t, rules, 1)
	rule := rules[0].(map[string]interface{})

	from := rule["from"].([]interface{})
	require.Len(t, from, 1)
	src := from[0].(map[string]interface{})["source"].(map[string]interface{})
	principals := src["principals"].([]interface{})
	require.Len(t, principals, 1)
	assert.Equal(t,
		"cluster.local/ns/test-agents/sa/my-instance",
		principals[0],
		"principal must include the configured trust domain + agent ns + instance name")

	to := rule["to"].([]interface{})
	require.Len(t, to, 1)
	op := to[0].(map[string]interface{})["operation"].(map[string]interface{})
	paths := op["paths"].([]interface{})
	require.Len(t, paths, 1)
	assert.Equal(t, "/api/instances/my-instance/*", paths[0],
		"path prefix must be scoped to this instance only — that's the cross-check ADR-039 used to do in api-server middleware")
}
