package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

var authorizationPolicyGVR = schema.GroupVersionResource{
	Group:    "security.istio.io",
	Version:  "v1",
	Resource: "authorizationpolicies",
}

// BuildInstanceAuthorizationPolicy renders the Istio AuthorizationPolicy
// that pins the per-instance principal SA to its own URL `:id` segment
// at the harness Service waypoint (ADR-039). The policy targets the
// harness Service via `targetRefs` so it only applies to traffic flowing
// through the waypoint; the api-server's harness handler can then trust
// that anything reaching it on `/api/instances/<id>/*` was admitted by
// Istio against principal `<trust-domain>/ns/<agent-ns>/sa/<id>`.
//
// Lifecycle: lives in the release namespace alongside the harness
// Service, owner-refed to the instance ConfigMap so K8s GC reaps it on
// instance deletion. Naming includes a `-harness` suffix so it doesn't
// collide with any other AuthorizationPolicy a future feature might
// install for the same instance.
func BuildInstanceAuthorizationPolicy(name string, cfg *config.Config, ownerCM *corev1.ConfigMap) *unstructured.Unstructured {
	principal := fmt.Sprintf("%s/ns/%s/sa/%s", cfg.IstioTrustDomain, cfg.Namespace, name)
	pathPrefix := fmt.Sprintf("/api/instances/%s/*", name)

	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "security.istio.io",
		Version: "v1",
		Kind:    "AuthorizationPolicy",
	})
	u.SetName(name + "-harness")
	u.SetNamespace(cfg.ReleaseNamespace)
	u.SetLabels(map[string]string{
		LabelInstance: name,
	})
	u.SetOwnerReferences([]metav1.OwnerReference{
		*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
	})
	u.Object["spec"] = map[string]interface{}{
		"targetRefs": []interface{}{
			map[string]interface{}{
				"group": "",
				"kind":  "Service",
				"name":  fmt.Sprintf("%s-apiserver-harness", cfg.ReleaseName),
			},
		},
		"action": "ALLOW",
		"rules": []interface{}{
			map[string]interface{}{
				"from": []interface{}{
					map[string]interface{}{
						"source": map[string]interface{}{
							"principals": []interface{}{principal},
						},
					},
				},
				"to": []interface{}{
					map[string]interface{}{
						"operation": map[string]interface{}{
							"paths": []interface{}{pathPrefix},
						},
					},
				},
			},
		},
	}
	return u
}
