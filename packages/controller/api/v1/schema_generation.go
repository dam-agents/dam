package v1

// CRD schema generations. Shared-cluster CRDs are frozen for
// environment deploys, so the controller asserts at startup that the live CRD
// carries at least the generation it was built against. On any schema change,
// bump the constant together with the matching
// +kubebuilder:metadata:annotations marker on the type; the api/v1 test fails
// if they drift from the generated manifests.
const (
	SchemaGenerationAnnotation = "agent-platform.ai/crd-schema-generation"

	// Agent gen 2: imagePullSecretRef added to AgentSpec (#930/#932).
	AgentSchemaGeneration = 2
	ForkSchemaGeneration  = 1
	RunSchemaGeneration   = 1
)
