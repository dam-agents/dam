package reconciler

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// GVRs / GVKs for the reconciled custom resources.
var (
	AgentsGVR = apiv1.GroupVersion.WithResource("agents")
	// UserBudgetsGVR is read live at each budget check (no informer):
	// 0→1 transitions are rare and a live read keeps enforcement unlagged.
	UserBudgetsGVR = apiv1.GroupVersion.WithResource("userbudgets")

	agentGVK = apiv1.GroupVersion.WithKind("Agent")
)

// FromCacheObject converts an informer/lister/dynamic-client object into a typed
// CR. The dynamic client and dynamic informer surface custom resources as
// *unstructured.Unstructured; this is the single conversion point for all CRs.
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

// agentToUnstructured is the inverse of FromCacheObject, used to apply
// or seed Agent objects through the dynamic client.
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

// agentOwnerRef builds the controller owner reference to an Agent CR. Children
// the reconciler renders in the agent namespace (StatefulSets, Services, SA,
// NetworkPolicy, Envoy bootstrap CM, leaf Certificate) carry this so K8s GC
// cascade-deletes them with the Agent.
func agentOwnerRef(agent *apiv1.Agent) metav1.OwnerReference {
	return *metav1.NewControllerRef(agent, agentGVK)
}

// agentLister adapts the dynamic informer's cache to AgentGetter so the agent
// resolver reads agents from the shared cache rather than hitting the API.
type agentLister struct {
	lister cache.GenericLister
	ns     string
}

// NewAgentLister builds the prod AgentGetter backed by the Agent dynamic
// informer's lister.
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
