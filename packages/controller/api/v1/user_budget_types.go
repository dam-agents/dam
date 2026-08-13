package v1

import (
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type UserBudgetSpec struct {
	// +kubebuilder:validation:MinLength=1
	// +kubebuilder:validation:MaxLength=246
	// +kubebuilder:validation:Pattern=`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`
	Owner string `json:"owner"`
	// +kubebuilder:validation:XValidation:rule="type(self) == int ? self > 0 : quantity(string(self)).isGreaterThan(quantity('0'))",message="cpu must be a positive quantity"
	CPU resource.Quantity `json:"cpu"`
	// +kubebuilder:validation:XValidation:rule="type(self) == int ? self > 0 : quantity(string(self)).isGreaterThan(quantity('0'))",message="memory must be a positive quantity"
	Memory resource.Quantity `json:"memory"`
}

type UserBudgetStatus struct {
	// +optional
	// +listType=map
	// +listMapKey=type
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced
// +kubebuilder:metadata:annotations=helm.sh/resource-policy=keep
// +kubebuilder:metadata:annotations=agent-platform.ai/crd-schema-generation=1
// +kubebuilder:printcolumn:name="Owner",type=string,JSONPath=`.spec.owner`
// +kubebuilder:printcolumn:name="CPU",type=string,JSONPath=`.spec.cpu`
// +kubebuilder:printcolumn:name="Memory",type=string,JSONPath=`.spec.memory`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +kubebuilder:validation:XValidation:rule="self.metadata.name == 'budget-' + self.spec.owner",message="metadata.name must be 'budget-<spec.owner>' — one UserBudget per user"

type UserBudget struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   UserBudgetSpec   `json:"spec,omitempty"`
	Status UserBudgetStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

type UserBudgetList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []UserBudget `json:"items"`
}
