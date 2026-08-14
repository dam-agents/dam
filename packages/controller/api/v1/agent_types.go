package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// +kubebuilder:validation:XValidation:rule="!has(self.backend) || self.backend.type != 'vm' || !has(self.runtimeClassName)",message="runtimeClassName selects a container runtime and is invalid on the vm backend"
// +kubebuilder:validation:XValidation:rule="!has(self.backend) || self.backend.type != 'vm' || !has(self.secretRef)",message="secretRef (envFrom projection) is not supported on the vm backend"
type AgentSpec struct {
	Image string `json:"image"`

	// +optional
	Name string `json:"name,omitempty"`
	// +optional
	Description string `json:"description,omitempty"`
	// +optional
	Init string `json:"init,omitempty"`
	// +optional
	Mounts []Mount `json:"mounts,omitempty"`
	// +optional
	Env []EnvVar `json:"env,omitempty"`
	// +optional
	Resources ResourceSpec `json:"resources,omitempty"`

	// +optional
	HibernationTimeout *metav1.Duration `json:"hibernationTimeout,omitempty"`

	// +optional
	ImagePullPolicy string `json:"imagePullPolicy,omitempty"`
	// +optional
	StorageSize string `json:"storageSize,omitempty"`
	// +optional
	AgentHome string `json:"agentHome,omitempty"`

	// +optional
	RuntimeClassName string `json:"runtimeClassName,omitempty"`
	// +optional
	NodeSelector map[string]string `json:"nodeSelector,omitempty"`

	// +optional
	Backend *Backend `json:"backend,omitempty"`

	// +optional
	SecretRef string `json:"secretRef,omitempty"`

	// +optional
	ImagePullSecretRef string `json:"imagePullSecretRef,omitempty"`

	// +optional
	GrantedSecretIDs []string `json:"grantedSecretIds,omitempty"`
	// +optional
	GrantedConnectionIDs []string `json:"grantedConnectionIds,omitempty"`

	// +optional
	// +kubebuilder:validation:MaxItems=256
	// +kubebuilder:validation:items:MaxLength=253
	// +kubebuilder:validation:items:Pattern=`^(\*\.)?([a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$`
	L7Hosts []string `json:"l7Hosts,omitempty"`

	// +optional
	TelemetryAttributionID string `json:"telemetryAttributionId,omitempty"`
}

// +kubebuilder:validation:XValidation:rule="self.type == 'vm' || !has(self.vm)",message="vm block requires type: vm"
type Backend struct {
	// +kubebuilder:validation:Enum=container;vm
	Type string `json:"type"`
	// +optional
	VM *VMBackend `json:"vm,omitempty"`
}

type VMBackend struct{}

func (s *AgentSpec) IsVM() bool {
	return s.Backend != nil && s.Backend.Type == "vm"
}

const (
	ConditionReady           = "Ready"
	ConditionAgentPodReady   = "AgentPodReady"
	ConditionGatewayPodReady = "GatewayPodReady"
	ConditionReconciled      = "Reconciled"
)

const ReasonHibernated = "Hibernated"

const ReasonOverBudget = "OverBudget"

const ReasonStuckOnSupersededRevision = "StuckOnSupersededRevision"

type AgentStatus struct {
	// +optional
	// +listType=map
	// +listMapKey=type
	Conditions []metav1.Condition `json:"conditions,omitempty"`
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
}

type Mount struct {
	Path    string `json:"path"`
	Persist bool   `json:"persist"`
	// +optional
	Size string `json:"size,omitempty"`
}

type EnvVar struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type ResourceSpec struct {
	// +optional
	Requests map[string]string `json:"requests,omitempty"`
	// +optional
	Limits map[string]string `json:"limits,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=agt
// +kubebuilder:metadata:annotations=helm.sh/resource-policy=keep
// +kubebuilder:metadata:annotations=agent-platform.ai/crd-schema-generation=7
// +kubebuilder:printcolumn:name="Ready",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].status`
// +kubebuilder:printcolumn:name="Reason",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].reason`
// +kubebuilder:printcolumn:name="Image",type=string,JSONPath=`.spec.image`,priority=1
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

type Agent struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   AgentSpec   `json:"spec,omitempty"`
	Status AgentStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

type AgentList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Agent `json:"items"`
}
