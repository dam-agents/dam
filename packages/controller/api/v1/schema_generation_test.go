package v1

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"sigs.k8s.io/yaml"
)

// The generated chart manifests must carry the schema-generation constants —
// catches a bumped constant without `mise run controller:generate`, or a
// +kubebuilder:metadata:annotations marker out of sync with the constant.
func TestGeneratedCRDsCarrySchemaGeneration(t *testing.T) {
	cases := map[string]int{
		"agent-platform.ai_agents.yaml": AgentSchemaGeneration,
		"agent-platform.ai_forks.yaml":  ForkSchemaGeneration,
		"agent-platform.ai_runs.yaml":   RunSchemaGeneration,
	}
	for file, want := range cases {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "deploy", "helm", "platform", "crds", file))
		if err != nil {
			t.Fatalf("reading generated CRD: %v", err)
		}
		var crd struct {
			Metadata struct {
				Annotations map[string]string `json:"annotations"`
			} `json:"metadata"`
		}
		if err := yaml.Unmarshal(raw, &crd); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		got, err := strconv.Atoi(crd.Metadata.Annotations[SchemaGenerationAnnotation])
		if err != nil {
			t.Fatalf("%s: %s annotation missing or not an int: %v", file, SchemaGenerationAnnotation, err)
		}
		if got != want {
			t.Errorf("%s: schema generation %d in manifest, %d in code — bump both and run mise run controller:generate", file, got, want)
		}
	}
}
