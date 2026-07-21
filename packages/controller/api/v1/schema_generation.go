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
	AgentSchemaGeneration = 4
	// Fork gen 2: Hibernated added to the status phase enum — forks became
	// durable per-replier runtimes that hibernate instead of completing (#2843).
	ForkSchemaGeneration = 2
	RunSchemaGeneration  = 1
	// UserBudget gen 1: per-user concurrent-compute ceiling (#1900).
	// Ceilings must be positive quantities; owner must be name-constructible
	// (DNS-1123, ≤246 chars) so `budget-<owner>` is a legal object name.
	// (Folded into gen 1 pre-release — this CRD ships first with this PR.)
	UserBudgetSchemaGeneration = 1
)
