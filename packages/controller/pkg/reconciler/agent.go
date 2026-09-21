package reconciler

import (
	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

type AgentGetter interface {
	Get(name string) (*apiv1.Agent, error)
}
