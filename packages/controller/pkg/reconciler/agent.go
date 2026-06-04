package reconciler

import (
	"fmt"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// AgentGetter abstracts how agents are looked up — the dynamic informer lister
// in prod, a map in tests (ADR-058: agents are custom resources).
type AgentGetter interface {
	Get(name string) (*apiv1.Agent, error)
}

type AgentResolver struct {
	getter AgentGetter
}

func NewAgentResolver(getter AgentGetter) *AgentResolver {
	return &AgentResolver{getter: getter}
}

// Resolve returns the Agent CR (for owner-reference metadata) and its spec.
// The spec is consumed directly off the typed resource — K8s validated it at
// admission, so there is no app-layer re-parse or re-validation (ADR-058).
func (r *AgentResolver) Resolve(name string) (*apiv1.Agent, *types.AgentSpec, error) {
	agent, err := r.getter.Get(name)
	if err != nil {
		return nil, nil, fmt.Errorf("agent %q not found: %w", name, err)
	}
	return agent, &agent.Spec, nil
}
