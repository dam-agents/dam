// Package v1 defines the agent-platform.ai/v1 API types the platform
// controller reconciles: Agent and Fork. These custom resources supersede the
// earlier labeled-ConfigMap resource model. The api-server is
// the sole writer of each resource's spec; the controller is the sole writer of
// its status subresource.
//
// +kubebuilder:object:generate=true
// +groupName=agent-platform.ai
package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// GroupVersion is the API group and version for these types.
var GroupVersion = schema.GroupVersion{Group: "agent-platform.ai", Version: "v1"}

var (
	// SchemeBuilder registers these types with a runtime.Scheme.
	SchemeBuilder = runtime.NewSchemeBuilder(addKnownTypes)
	// AddToScheme adds the GroupVersion types to a Scheme.
	AddToScheme = SchemeBuilder.AddToScheme
)

func addKnownTypes(scheme *runtime.Scheme) error {
	scheme.AddKnownTypes(GroupVersion,
		&Agent{}, &AgentList{},
		&Fork{}, &ForkList{},
	)
	metav1.AddToGroupVersion(scheme, GroupVersion)
	return nil
}
