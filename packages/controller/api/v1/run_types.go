package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// RunSpec is an ephemeral executor derived from an Agent, backing the in-pod
// `dam-run` CLI: it materializes a throwaway sandbox pod (same image, config,
// and RWX workspace as the parent) that runs one command streamed over
// /api/exec. Unlike a Fork it runs as the parent Agent's own owner. The command
// argv is deliberately NOT stored here — it travels only over the exec
// WebSocket — so the executor pod is generic and no command bytes land in etcd.
// The api-server is the sole writer of the spec and deletes the Run when the
// streaming connection ends.
type RunSpec struct {
	// AgentName names the parent Agent this run derives from.
	AgentName string `json:"agentName"`
}

// RunPhase is the lifecycle phase of an executor run.
//
// +kubebuilder:validation:Enum=Pending;Ready;Failed;Completed
type RunPhase string

const (
	RunPhasePending   RunPhase = "Pending"
	RunPhaseReady     RunPhase = "Ready"
	RunPhaseFailed    RunPhase = "Failed"
	RunPhaseCompleted RunPhase = "Completed"
)

// RunError carries a structured failure reason on a failed run.
type RunError struct {
	Reason string `json:"reason"`
	// +optional
	Detail string `json:"detail,omitempty"`
}

// RunStatus is the observed state of an executor run. The controller is the
// sole writer, via the status subresource.
type RunStatus struct {
	// +optional
	Phase RunPhase `json:"phase,omitempty"`
	// +optional
	PodIP string `json:"podIP,omitempty"`
	// +optional
	Error *RunError `json:"error,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced
// +kubebuilder:metadata:annotations=helm.sh/resource-policy=keep
// +kubebuilder:metadata:annotations=agent-platform.ai/crd-schema-generation=1
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Agent",type=string,JSONPath=`.spec.agentName`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// Run is an ephemeral single-command executor derived from an Agent.
type Run struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   RunSpec   `json:"spec,omitempty"`
	Status RunStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// RunList is a list of Runs.
type RunList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Run `json:"items"`
}
