package types

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/api/resource"
	sigsyaml "sigs.k8s.io/yaml"

	v1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// Spec shapes are aliases of the api/v1 CRD types: each is authored
// Go-first under api/v1 and consumed here, so there is a single definition. The
// controller reads these directly off the typed custom resources; status lives
// on the CR status subresource (api/v1.AgentStatus / api/v1.RunStatus), so
// there are no local status shapes.
type (
	AgentSpec    = v1.AgentSpec
	Mount        = v1.Mount
	EnvVar       = v1.EnvVar
	ResourceSpec = v1.ResourceSpec
)

// Run failure reasons stamped onto api/v1.RunError.Reason by the reconciler.
const (
	RunReasonOrchestrationFailed = "OrchestrationFailed"
	RunReasonPodNotReady         = "PodNotReady"
	RunReasonTimeout             = "Timeout"
)

// ParseAgentSpec parses a ConfigMap spec.yaml into the api/v1 AgentSpec. Legacy
// fields the CRD dropped (version, desiredState) are ignored. Uses
// sigs.k8s.io/yaml so the JSON tags on the v1 types are honored.
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

// SanitizeMountName converts a mount path to a K8s-safe volume name.
// "/workspace" -> "workspace", "/home/agent" -> "home-agent"
func SanitizeMountName(path string) string {
	name := strings.TrimPrefix(path, "/")
	return strings.ReplaceAll(name, "/", "-")
}
