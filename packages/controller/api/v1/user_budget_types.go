package v1

import (
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// UserBudgetSpec is one user's Ceiling override: the maximum CPU and memory
// that user's scaled-up Agents may use concurrently, as the sum of their
// Sizes — `spec.resources.limits` (#1900), which hard-cap consumption. The
// uniform per-agent gateway overhead is deliberately excluded from the sum;
// per-command Run pods are not counted. Users without a UserBudget get the
// chart-wide default ceiling (`controller.userBudgets`). Operators write
// these; the controller enforces them at the 0→1 scale transition and the
// api-server reads them for display.
type UserBudgetSpec struct {
	// Owner is the exact plaintext Keycloak subject the
	// `agent-platform.ai/owner` label carries on the user's Agents. The
	// pattern/length keep `budget-<owner>` a constructible object name
	// (DNS-1123 subdomain), so a sub this schema admits can always get a
	// budget — a non-conforming IdP sub fails here with a clear message
	// instead of an opaque metadata.name error.
	// +kubebuilder:validation:MinLength=1
	// +kubebuilder:validation:MaxLength=246
	// +kubebuilder:validation:Pattern=`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`
	Owner string `json:"owner"`
	// CPU is the ceiling on summed CPU limits (e.g. "8" or "8000m").
	// Must be positive: a zero or negative ceiling would permanently park
	// every start, which is what deleting the UserBudget plus a low chart
	// default is for — refuse it at admission rather than enforce it.
	// (isGreaterThan, not sign(): sign() fails CEL compilation on the API
	// servers we target — verified live on k3s v1.36.)
	// +kubebuilder:validation:XValidation:rule="type(self) == int ? self > 0 : quantity(string(self)).isGreaterThan(quantity('0'))",message="cpu must be a positive quantity"
	CPU resource.Quantity `json:"cpu"`
	// Memory is the ceiling on summed memory limits (e.g. "16Gi").
	// +kubebuilder:validation:XValidation:rule="type(self) == int ? self > 0 : quantity(string(self)).isGreaterThan(quantity('0'))",message="memory must be a positive quantity"
	Memory resource.Quantity `json:"memory"`
}

// UserBudgetStatus is reserved for controller-written conditions; the
// controller does not publish per-owner usage here (Reserved is derived from
// Agent specs on demand).
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

// UserBudget grants one user a raised (or lowered) concurrent-compute
// Ceiling. The name is pinned to `budget-<spec.owner>` at admission, so at
// most one UserBudget can exist per user by construction.
type UserBudget struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   UserBudgetSpec   `json:"spec,omitempty"`
	Status UserBudgetStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// UserBudgetList is a list of UserBudgets.
type UserBudgetList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []UserBudget `json:"items"`
}
