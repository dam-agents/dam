// +kubebuilder:object:generate=true
// +groupName=agent-platform.ai
package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var GroupVersion = schema.GroupVersion{Group: "agent-platform.ai", Version: "v1"}

var (
	SchemeBuilder = runtime.NewSchemeBuilder(addKnownTypes)
	AddToScheme   = SchemeBuilder.AddToScheme
)

func addKnownTypes(scheme *runtime.Scheme) error {
	scheme.AddKnownTypes(GroupVersion,
		&Agent{}, &AgentList{},
		&UserBudget{}, &UserBudgetList{},
	)
	metav1.AddToGroupVersion(scheme, GroupVersion)
	return nil
}
