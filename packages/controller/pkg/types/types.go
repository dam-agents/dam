package types

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/api/resource"
	sigsyaml "sigs.k8s.io/yaml"

	v1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// Spec shapes are aliases of the api/v1 CRD types (ADR-058): each is authored
// Go-first under api/v1 and consumed here, so there is a single definition. The
// controller reads these directly off the typed custom resources; status lives
// on the CR status subresource (api/v1.AgentStatus / api/v1.ForkStatus), so
// there are no local status shapes.
type (
	AgentSpec    = v1.AgentSpec
	Mount        = v1.Mount
	EnvVar       = v1.EnvVar
	ResourceSpec = v1.ResourceSpec
	ForkSpec     = v1.ForkSpec
	ForkError    = v1.ForkError
)

// Fork failure reasons stamped onto api/v1.ForkError.Reason by the reconciler.
const (
	ForkReasonCredentialMintFailed = "CredentialMintFailed"
	ForkReasonOrchestrationFailed  = "OrchestrationFailed"
	ForkReasonPodNotReady          = "PodNotReady"
	ForkReasonTimeout              = "Timeout"
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

// ParseForkSpec parses a ConfigMap spec.yaml into the api/v1 ForkSpec. Uses
// sigs.k8s.io/yaml so the JSON tags (agentName, foreignSub) are honored.
func ParseForkSpec(data string) (*ForkSpec, error) {
	var spec ForkSpec
	if err := sigsyaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing fork spec: %w", err)
	}
	if spec.AgentName == "" {
		return nil, fmt.Errorf("fork spec: agentName is required")
	}
	if spec.ForeignSub == "" {
		return nil, fmt.Errorf("fork spec: foreignSub is required")
	}
	return &spec, nil
}

// SanitizeMountName converts a mount path to a K8s-safe volume name.
// "/workspace" -> "workspace", "/home/agent" -> "home-agent"
func SanitizeMountName(path string) string {
	name := strings.TrimPrefix(path, "/")
	return strings.ReplaceAll(name, "/", "-")
}
