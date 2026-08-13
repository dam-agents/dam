package reconciler

import (
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const (
	istioGroup    = "security.istio.io"
	istioVersion  = "v1"
	istioResource = "authorizationpolicies"
)

var authzPolicyGVR = schema.GroupVersionResource{
	Group:    istioGroup,
	Version:  istioVersion,
	Resource: istioResource,
}

func authzPolicy(name, namespace, ownerNamespace string, ownerRef metav1.OwnerReference, labels map[string]string, spec map[string]interface{}) *unstructured.Unstructured {
	meta := map[string]interface{}{
		"name":      name,
		"namespace": namespace,
		"labels":    toInterfaceMap(labels),
	}
	if ownerNamespace == namespace {
		meta["ownerReferences"] = []interface{}{
			ownerRefAsMap(&ownerRef),
		}
	}
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": fmt.Sprintf("%s/%s", istioGroup, istioVersion),
		"kind":       "AuthorizationPolicy",
		"metadata":   meta,
		"spec":       spec,
	}}
}

func toInterfaceMap(m map[string]string) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func ownerRefAsMap(r *metav1.OwnerReference) map[string]interface{} {
	m := map[string]interface{}{
		"apiVersion": r.APIVersion,
		"kind":       r.Kind,
		"name":       r.Name,
		"uid":        string(r.UID),
	}
	if r.Controller != nil {
		m["controller"] = *r.Controller
	}
	if r.BlockOwnerDeletion != nil {
		m["blockOwnerDeletion"] = *r.BlockOwnerDeletion
	}
	return m
}

func BuildHarnessAuthorizationPolicy(principalAgentID string, cfg *config.Config, ownerNamespace string, ownerRef metav1.OwnerReference) *unstructured.Unstructured {
	spec := map[string]interface{}{
		"targetRefs": []interface{}{
			map[string]interface{}{
				"group": "gateway.networking.k8s.io",
				"kind":  "Gateway",
				"name":  cfg.IstioWaypointName,
			},
		},
		"action": "ALLOW",
		"rules": []interface{}{
			map[string]interface{}{
				"from": []interface{}{
					map[string]interface{}{
						"source": map[string]interface{}{
							"principals": []interface{}{cfg.PrincipalFor(principalAgentID)},
						},
					},
				},
				"to": []interface{}{
					map[string]interface{}{
						"operation": map[string]interface{}{
							"paths": []interface{}{fmt.Sprintf("/api/agents/%s/*", principalAgentID)},
						},
					},
				},
			},
		},
	}
	labels := map[string]string{
		LabelAgent:                     principalAgentID,
		"agent-platform.ai/managed-by": "platform-controller",
		"app.kubernetes.io/component":  "apiserver",
	}
	return authzPolicy(principalAgentID+"-harness-allow", cfg.ReleaseNamespace, ownerNamespace, ownerRef, labels, spec)
}

func BuildExtAuthzAuthorizationPolicy(agentName string, cfg *config.Config, ownerNamespace string, ownerRef metav1.OwnerReference) *unstructured.Unstructured {
	spec := map[string]interface{}{
		"targetRefs": []interface{}{
			map[string]interface{}{
				"group": "",
				"kind":  "Service",
				"name":  cfg.ExtAuthzServiceName(agentName),
			},
		},
		"action": "ALLOW",
		"rules": []interface{}{
			map[string]interface{}{
				"from": []interface{}{
					map[string]interface{}{
						"source": map[string]interface{}{
							"principals": []interface{}{cfg.PrincipalFor(agentName)},
						},
					},
				},
			},
		},
	}
	labels := map[string]string{
		LabelAgent:                     agentName,
		"agent-platform.ai/managed-by": "platform-controller",
		"app.kubernetes.io/component":  "apiserver",
	}
	return authzPolicy(agentName+"-extauthz-allow", cfg.ReleaseNamespace, ownerNamespace, ownerRef, labels, spec)
}

func (r *AgentReconciler) applyAuthorizationPolicy(ctx context.Context, desired *unstructured.Unstructured) error {
	if r.dynamic == nil {
		return fmt.Errorf("dynamic client not configured (AuthorizationPolicy cannot be applied)")
	}
	ns := desired.GetNamespace()
	cli := r.dynamic.Resource(authzPolicyGVR).Namespace(ns)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := cli.Get(ctx, desired.GetName(), metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		desired.SetResourceVersion(existing.GetResourceVersion())
		_, err = cli.Update(ctx, desired, metav1.UpdateOptions{})
		return err
	})
}
