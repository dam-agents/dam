package reconciler

import (

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// AgentGetter abstracts how agents are looked up — the dynamic informer lister
// in prod, a map in tests (agents are custom resources).
type AgentGetter interface {
	Get(name string) (*apiv1.Agent, error)
}

