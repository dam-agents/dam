package reconciler

import (
	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

type AgentGetter interface {
	Get(name string) (*apiv1.Agent, error)
}
