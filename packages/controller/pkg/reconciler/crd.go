package reconciler

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/cache"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// GVRs / GVKs for the reconciled custom resources (ADR-058). Agents are the
// durable per-agent resource the controller watches; the fork GVR is declared
// here for the (forthcoming) fork cutover but agents are the only CR the
// controller reconciles today.
var (
	AgentsGVR = apiv1.GroupVersion.WithResource("agents")
	ForksGVR  = apiv1.GroupVersion.WithResource("forks")

	agentGVK = apiv1.GroupVersion.WithKind("Agent")
	forkGVK  = apiv1.GroupVersion.WithKind("Fork")
)

// agentFromUnstructured converts an informer/lister/dynamic-client object into
// a typed Agent. The dynamic client and dynamic informer surface custom
// resources as *unstructured.Unstructured; this is the single conversion point.
func agentFromUnstructured(obj interface{}) (*apiv1.Agent, error) {
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return nil, fmt.Errorf("expected *unstructured.Unstructured, got %T", obj)
	}
	agent := &apiv1.Agent{}
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, agent); err != nil {
		return nil, fmt.Errorf("converting unstructured to Agent: %w", err)
	}
	return agent, nil
}

// agentToUnstructured is the inverse of agentFromUnstructured, used to apply
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

// agentLister adapts the dynamic informer's cache to AgentGetter so the fork
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
	return agentFromUnstructured(obj)
}

// forkFromUnstructured converts an informer/lister/dynamic-client object into a
// typed Fork. Exported as ForkFromCacheObject for the worker in main.
func forkFromUnstructured(obj interface{}) (*apiv1.Fork, error) {
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return nil, fmt.Errorf("expected *unstructured.Unstructured, got %T", obj)
	}
	fork := &apiv1.Fork{}
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, fork); err != nil {
		return nil, fmt.Errorf("converting unstructured to Fork: %w", err)
	}
	return fork, nil
}

// ForkFromCacheObject converts a cache object (lister/informer payload) into a
// typed Fork for the fork work queue.
func ForkFromCacheObject(obj interface{}) (*apiv1.Fork, error) {
	return forkFromUnstructured(obj)
}

// forkToUnstructured is the inverse, used to seed/apply Fork objects.
func forkToUnstructured(fork *apiv1.Fork) (*unstructured.Unstructured, error) {
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(fork)
	if err != nil {
		return nil, fmt.Errorf("converting Fork to unstructured: %w", err)
	}
	u := &unstructured.Unstructured{Object: raw}
	u.SetAPIVersion(apiv1.GroupVersion.String())
	u.SetKind("Fork")
	return u, nil
}

// forkOwnerRef builds the controller owner reference to a Fork CR. Children the
// reconciler renders in the agent namespace carry this so K8s GC cascade-deletes
// them with the Fork.
func forkOwnerRef(fork *apiv1.Fork) metav1.OwnerReference {
	return *metav1.NewControllerRef(fork, forkGVK)
}
