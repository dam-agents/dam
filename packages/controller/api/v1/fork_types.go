package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ForkSpec is the per-turn ephemeral runtime that derives from an Agent —
// Forks survived the Instance/Agent collapse. The parent Agent's
// egress surface scopes what the fork can reach. The api-server is the sole
// writer.
type ForkSpec struct {
	// AgentName names the parent Agent this fork impersonates.
	AgentName string `json:"agentName"`
	// ForeignSub is the foreign user identity the fork runs as.
	ForeignSub string `json:"foreignSub"`
	// SessionID is the optional originating session.
	// +optional
	SessionID string `json:"sessionId,omitempty"`
}

// ForkPhase is the lifecycle phase of a fork run.
//
// +kubebuilder:validation:Enum=Pending;Ready;Failed;Completed
type ForkPhase string

const (
	ForkPhasePending   ForkPhase = "Pending"
	ForkPhaseReady     ForkPhase = "Ready"
	ForkPhaseFailed    ForkPhase = "Failed"
	ForkPhaseCompleted ForkPhase = "Completed"
)

// ForkError carries a structured failure reason on a failed fork.
type ForkError struct {
	Reason string `json:"reason"`
	// +optional
	Detail string `json:"detail,omitempty"`
}

// ForkStatus is the observed state of a fork. The controller is the sole
// writer, via the status subresource.
type ForkStatus struct {
	// +optional
	Phase ForkPhase `json:"phase,omitempty"`
	// +optional
	JobName string `json:"jobName,omitempty"`
	// +optional
	PodIP string `json:"podIP,omitempty"`
	// +optional
	Error *ForkError `json:"error,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced
// +kubebuilder:metadata:annotations=helm.sh/resource-policy=keep
// +kubebuilder:metadata:annotations=agent-platform.ai/crd-schema-generation=1
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Agent",type=string,JSONPath=`.spec.agentName`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// Fork is a per-turn impersonation run derived from an Agent.
type Fork struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ForkSpec   `json:"spec,omitempty"`
	Status ForkStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// ForkList is a list of Forks.
type ForkList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Fork `json:"items"`
}
