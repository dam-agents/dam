package v1

// +kubebuilder:metadata:annotations marker on the type; the api/v1 test fails
const (
	SchemaGenerationAnnotation = "agent-platform.ai/crd-schema-generation"

	AgentSchemaGeneration      = 7
	UserBudgetSchemaGeneration = 1
)
