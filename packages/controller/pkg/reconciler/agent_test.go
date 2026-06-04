package reconciler

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// fakeGetter implements AgentGetter for tests (ADR-058: agents are CRs).
type fakeGetter struct {
	agents map[string]*apiv1.Agent
}

func (f *fakeGetter) Get(name string) (*apiv1.Agent, error) {
	agent, ok := f.agents[name]
	if !ok {
		return nil, fmt.Errorf("not found: %s", name)
	}
	return agent, nil
}

func TestResolveAgent(t *testing.T) {
	getter := &fakeGetter{agents: map[string]*apiv1.Agent{
		"claude-code": {
			ObjectMeta: metav1.ObjectMeta{Name: "claude-code", Namespace: "test-agents", UID: "agent-uid"},
			Spec: types.AgentSpec{
				Image: "ghcr.io/myorg/claude-code:latest",
				Mounts: []types.Mount{
					{Path: "/home/agent", Persist: true},
					{Path: "/tmp", Persist: false},
				},
			},
		},
	}}
	resolver := NewAgentResolver(getter)
	agent, spec, err := resolver.Resolve("claude-code")
	require.NoError(t, err)
	assert.Equal(t, "claude-code", agent.Name)
	assert.EqualValues(t, "agent-uid", agent.UID)
	assert.Equal(t, "ghcr.io/myorg/claude-code:latest", spec.Image)
	assert.Len(t, spec.Mounts, 2)
}

func TestResolveAgent_NotFound(t *testing.T) {
	resolver := NewAgentResolver(&fakeGetter{agents: map[string]*apiv1.Agent{}})
	_, _, err := resolver.Resolve("missing")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}
