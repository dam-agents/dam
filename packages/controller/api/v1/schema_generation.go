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
	// Agent gen 3: hibernationTimeout (per-agent idle-timeout override, duration) added to AgentSpec.
	// Agent gen 4: runtimeClassName + nodeSelector added to AgentSpec for
	// per-template scheduling (GPU-passthrough Kata workloads).
	// Agent gen 5: l7Hosts added to AgentSpec — per-agent L7 promotion
	// replaces the owner-scoped allow-only marker Secrets (#2865).
	// Agent gen 6: backend added to AgentSpec — discriminated union selecting
	// the isolation substrate (container | vm); vm reconciles a KubeVirt
	// VirtualMachine instead of the agent StatefulSet.
	// Agent gen 7: telemetryAttributionId added to AgentSpec — the trusted
	// telemetry attribution override the gateway stamps for Invocation targets
	// so their spend credits the root Driver (#3041).
	AgentSchemaGeneration = 7
	// UserBudget gen 1: per-user concurrent-compute ceiling (#1900).
	// Ceilings must be positive quantities; owner must be name-constructible
	// (DNS-1123, ≤246 chars) so `budget-<owner>` is a legal object name.
	// (Folded into gen 1 pre-release — this CRD ships first with this PR.)
	UserBudgetSchemaGeneration = 1
)
