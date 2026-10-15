package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// UserSpendLimitSpec is one user's Spend Ceiling: the most Metered Spend in
// US dollars that the user's Agents may spend on paid providers in one UTC
// day. At the ceiling the api-server's ext_authz gate refuses the next model
// call and asks nothing. It overrides the chart-wide
// `apiServer.spend.defaultUserCeilingUsd`. Operators write these; only the
// api-server reads them.
type UserSpendLimitSpec struct {
	// Owner is the exact plaintext Keycloak subject the
	// `agent-platform.ai/owner` label carries on the user's Agents. The
	// pattern/length keep `spend-limit-<owner>` a constructible object name
	// (DNS-1123 subdomain).
	// +kubebuilder:validation:MinLength=1
	// +kubebuilder:validation:MaxLength=241
	// +kubebuilder:validation:Pattern=`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`
	Owner string `json:"owner"`
	// DailyUsd is the ceiling in US dollars per UTC day, as a decimal string
	// with at most seven whole digits and two decimals (e.g. "50" or
	// "12.50"). "0" refuses every paid model call of the user.
	// +kubebuilder:validation:Pattern=`^[0-9]{1,7}(\.[0-9]{1,2})?$`
	DailyUsd string `json:"dailyUsd"`
}

// +kubebuilder:object:root=true
// +kubebuilder:resource:scope=Namespaced
// +kubebuilder:metadata:annotations=helm.sh/resource-policy=keep
// +kubebuilder:metadata:annotations=agent-platform.ai/crd-schema-generation=1
// +kubebuilder:printcolumn:name="Owner",type=string,JSONPath=`.spec.owner`
// +kubebuilder:printcolumn:name="Daily USD",type=string,JSONPath=`.spec.dailyUsd`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +kubebuilder:validation:XValidation:rule="self.metadata.name == 'spend-limit-' + self.spec.owner",message="metadata.name must be 'spend-limit-<spec.owner>' — one UserSpendLimit per user"

// UserSpendLimit sets one user's Spend Ceiling. The name is pinned to
// `spend-limit-<spec.owner>` at admission, so at most one UserSpendLimit can
// exist per user by construction.
type UserSpendLimit struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec UserSpendLimitSpec `json:"spec,omitempty"`
}

// +kubebuilder:object:root=true

// UserSpendLimitList is a list of UserSpendLimits.
type UserSpendLimitList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []UserSpendLimit `json:"items"`
}
