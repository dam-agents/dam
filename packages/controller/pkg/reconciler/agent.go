package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/humr/packages/controller/pkg/types"
)

// AgentGetter abstracts how agents are looked up — informer lister in prod, map in tests.
type AgentGetter interface {
	Get(name string) (*corev1.ConfigMap, error)
}

type AgentResolver struct {
	getter AgentGetter
}

func NewAgentResolver(getter AgentGetter) *AgentResolver {
	return &AgentResolver{getter: getter}
}

// Resolve returns the agent's ConfigMap (for owner-reference metadata) and
// its parsed spec.
func (r *AgentResolver) Resolve(name string) (*corev1.ConfigMap, *types.AgentSpec, error) {
	cm, err := r.getter.Get(name)
	if err != nil {
		return nil, nil, fmt.Errorf("agent %q not found: %w", name, err)
	}
	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return nil, nil, fmt.Errorf("agent %q has no spec.yaml", name)
	}
	spec, err := types.ParseAgentSpec(specYAML)
	if err != nil {
		return nil, nil, err
	}
	return cm, spec, nil
}
