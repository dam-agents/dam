package types

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/api/resource"
	sigsyaml "sigs.k8s.io/yaml"

	v1 "github.com/kagenti/platform/packages/controller/api/v1"
)

type (
	AgentSpec    = v1.AgentSpec
	Mount        = v1.Mount
	EnvVar       = v1.EnvVar
	ResourceSpec = v1.ResourceSpec
)

const (
	RunReasonOrchestrationFailed = "OrchestrationFailed"
	RunReasonPodNotReady         = "PodNotReady"
	RunReasonTimeout             = "Timeout"
)

func ParseAgentSpec(data string) (*AgentSpec, error) {
	var spec AgentSpec
	if err := sigsyaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing agent spec: %w", err)
	}
	if spec.Image == "" {
		return nil, fmt.Errorf("agent spec: image is required")
	}
	for _, m := range spec.Mounts {
		if !strings.HasPrefix(m.Path, "/") {
			return nil, fmt.Errorf("agent spec: mount path %q must be absolute", m.Path)
		}
		if m.Size != "" {
			if _, err := resource.ParseQuantity(m.Size); err != nil {
				return nil, fmt.Errorf("agent spec: mount %q size %q is not a valid K8s quantity: %w", m.Path, m.Size, err)
			}
		}
	}
	return &spec, nil
}

func SanitizeMountName(path string) string {
	name := strings.TrimPrefix(path, "/")
	return strings.ReplaceAll(name, "/", "-")
}
