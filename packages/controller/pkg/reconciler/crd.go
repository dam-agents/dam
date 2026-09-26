package reconciler

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

var (
	AgentsGVR      = apiv1.GroupVersion.WithResource("agents")
	UserBudgetsGVR = apiv1.GroupVersion.WithResource("userbudgets")

	agentGVK = apiv1.GroupVersion.WithKind("Agent")
)

func FromCacheObject[T any](obj interface{}) (*T, error) {
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return nil, fmt.Errorf("expected *unstructured.Unstructured, got %T", obj)
	}
	out := new(T)
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, out); err != nil {
		return nil, fmt.Errorf("converting unstructured to %T: %w", out, err)
	}
	return out, nil
}

func agentOwnerRef(agent *apiv1.Agent) metav1.OwnerReference {
	return *metav1.NewControllerRef(agent, agentGVK)
}
