package reconciler

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
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

func agentToUnstructured(agent *apiv1.Agent) (*unstructured.Unstructured, error) {
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(agent)
	if err != nil {
		return nil, fmt.Errorf("converting Agent to unstructured: %w", err)
	}
	u := &unstructured.Unstructured{Object: raw}
	u.SetAPIVersion(apiv1.GroupVersion.String())
	u.SetKind("Agent")
	return u, nil
}

func agentOwnerRef(agent *apiv1.Agent) metav1.OwnerReference {
	return *metav1.NewControllerRef(agent, agentGVK)
}

type agentLister struct {
	lister cache.GenericLister
	ns     string
}

func NewAgentLister(lister cache.GenericLister, ns string) AgentGetter {
	return agentLister{lister: lister, ns: ns}
}

func (g agentLister) Get(name string) (*apiv1.Agent, error) {
	obj, err := g.lister.ByNamespace(g.ns).Get(name)
	if err != nil {
		return nil, err
	}
	return FromCacheObject[apiv1.Agent](obj)
}
