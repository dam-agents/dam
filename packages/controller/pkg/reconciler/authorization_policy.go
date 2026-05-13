package reconciler

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Per-instance Istio AuthorizationPolicies. The controller writes two per
// instance, both in the release namespace:
//
//   1. `<id>-harness-allow`        — admission via the api-server's waypoint
//                                    Gateway to path `/api/instances/<id>/*`.
//   2. `<id>-extauthz-allow`       — admission to the per-instance ext-authz
//                                    Service. ALLOW principal — same SA.
//
// Both pin the principal to the instance's SA — but the principal here is
// the *gateway pod*'s SPIFFE identity. The agent pod is not a mesh
// participant (no SPIFFE), so all in-cluster identity work happens on the
// gateway → api-server hops. App handlers can treat URL `:id` (harness) or
// gRPC `:authority` (ext-authz) as already authenticated by the time the
// request reaches them. The agent → gateway hop is gated by the per-pair
// `<id>-agent-egress` NetworkPolicy at the kernel layer, not by mesh AuthZ
// — see network_policy.go.
//
// Forks (ADR-027) get their **own** per-fork SA — distinct from the parent —
// paired with two release-namespace policies that scope the fork narrowly
// to the parent's surface: `BuildForkHarnessAuthorizationPolicy` admits the
// fork SA only to `/api/instances/<parent>/mcp`, and
// `BuildForkExtAuthzAuthorizationPolicy` admits it to the parent's
// per-instance ext-authz Service.

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

// authzPolicy builds an unstructured AuthorizationPolicy with the given
// metadata + spec. Centralised so the three Build* helpers stay terse.
//
// `ownerCM` is consulted only when its namespace matches the policy's
// namespace — K8s ownerRef does not carry a namespace and assumes same-
// namespace, so a cross-namespace ref triggers K8s GC to reap the
// policy as orphaned. For policies in the release namespace (harness,
// ext-authz) we omit the ownerRef and clean them up by label in
// `instance.go Delete()`.
func authzPolicy(name, namespace string, ownerCM *corev1.ConfigMap, labels map[string]string, spec map[string]interface{}) *unstructured.Unstructured {
	meta := map[string]interface{}{
		"name":      name,
		"namespace": namespace,
		"labels":    toInterfaceMap(labels),
	}
	if ownerCM.Namespace == namespace {
		meta["ownerReferences"] = []interface{}{
			ownerRefAsMap(metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap"))),
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

// BuildHarnessAuthorizationPolicy admits traffic via the api-server's
// waypoint Gateway to path `/api/instances/<id>/*` from the matching SA
// principal only. Lives in the *release* namespace alongside the waypoint
// Gateway it targets.
//
// `principalInstanceID` is the instance ID; this is also the URL `:id`
// the policy enforces.
func BuildHarnessAuthorizationPolicy(principalInstanceID string, cfg *config.Config, ownerCM *corev1.ConfigMap) *unstructured.Unstructured {
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
							"principals": []interface{}{cfg.PrincipalFor(principalInstanceID)},
						},
					},
				},
				"to": []interface{}{
					map[string]interface{}{
						"operation": map[string]interface{}{
							"paths": []interface{}{fmt.Sprintf("/api/instances/%s/*", principalInstanceID)},
						},
					},
				},
			},
		},
	}
	labels := map[string]string{
		LabelInstance:                  principalInstanceID,
		"agent-platform.ai/managed-by": "platform-controller",
		"app.kubernetes.io/component":  "apiserver",
	}
	return authzPolicy(principalInstanceID+"-harness-allow", cfg.ReleaseNamespace, ownerCM, labels, spec)
}

// BuildForkHarnessAuthorizationPolicy admits the fork's SA principal to a
// **narrow** path under the parent instance — `/api/instances/<parent>/mcp`
// only, not the parent's full `/api/instances/<parent>/*` surface. This
// preserves the ADR-027 trust boundary: a compromised fork (i.e. a
// compromised foreign replier) cannot reach pod-files SSE,
// `/internal/trigger`, or any future per-instance harness endpoint scoped
// to the parent. Lives in the release namespace alongside the parent's
// harness-allow policy; Istio OR-s ALLOWs from multiple policies on the
// same waypoint, so this is purely additive.
func BuildForkHarnessAuthorizationPolicy(forkName, parentInstanceID string, cfg *config.Config, ownerCM *corev1.ConfigMap) *unstructured.Unstructured {
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
							"principals": []interface{}{cfg.PrincipalFor(forkName)},
						},
					},
				},
				"to": []interface{}{
					map[string]interface{}{
						"operation": map[string]interface{}{
							"paths": []interface{}{fmt.Sprintf("/api/instances/%s/mcp", parentInstanceID)},
						},
					},
				},
			},
		},
	}
	labels := map[string]string{
		LabelInstance:                  parentInstanceID,
		"agent-platform.ai/managed-by": "platform-controller",
		"app.kubernetes.io/component":  "apiserver",
		ForkLabelForkID:                forkName,
	}
	return authzPolicy(forkName+"-harness-allow", cfg.ReleaseNamespace, ownerCM, labels, spec)
}

// BuildForkExtAuthzAuthorizationPolicy admits the fork's SA principal to
// the **parent**'s per-instance ext-authz Service. Forks dial the
// parent's ext-authz endpoint (the parent owner's HITL rules approve
// the request; the fork's gateway then injects the replier's
// credential on the wire). The parent's own ext-authz-allow continues
// to admit the parent SA; Istio OR-s the principal lists across both
// policies on the same Service.
func BuildForkExtAuthzAuthorizationPolicy(forkName, parentInstanceID string, cfg *config.Config, ownerCM *corev1.ConfigMap) *unstructured.Unstructured {
	spec := map[string]interface{}{
		"targetRefs": []interface{}{
			map[string]interface{}{
				"group": "",
				"kind":  "Service",
				"name":  cfg.ExtAuthzServiceName(parentInstanceID),
			},
		},
		"action": "ALLOW",
		"rules": []interface{}{
			map[string]interface{}{
				"from": []interface{}{
					map[string]interface{}{
						"source": map[string]interface{}{
							"principals": []interface{}{cfg.PrincipalFor(forkName)},
						},
					},
				},
			},
		},
	}
	labels := map[string]string{
		LabelInstance:                  parentInstanceID,
		"agent-platform.ai/managed-by": "platform-controller",
		"app.kubernetes.io/component":  "apiserver",
		ForkLabelForkID:                forkName,
	}
	return authzPolicy(forkName+"-extauthz-allow", cfg.ReleaseNamespace, ownerCM, labels, spec)
}

// BuildExtAuthzAuthorizationPolicy admits traffic to the per-instance
// ext-authz Service from the matching SA principal only. Lives in the
// release namespace alongside the per-instance ext-authz Service it
// targets.
func BuildExtAuthzAuthorizationPolicy(instanceName string, cfg *config.Config, ownerCM *corev1.ConfigMap) *unstructured.Unstructured {
	spec := map[string]interface{}{
		"targetRefs": []interface{}{
			map[string]interface{}{
				"group": "",
				"kind":  "Service",
				"name":  cfg.ExtAuthzServiceName(instanceName),
			},
		},
		"action": "ALLOW",
		"rules": []interface{}{
			map[string]interface{}{
				"from": []interface{}{
					map[string]interface{}{
						"source": map[string]interface{}{
							"principals": []interface{}{cfg.PrincipalFor(instanceName)},
						},
					},
				},
			},
		},
	}
	labels := map[string]string{
		LabelInstance:                  instanceName,
		"agent-platform.ai/managed-by": "platform-controller",
		"app.kubernetes.io/component":  "apiserver",
	}
	return authzPolicy(instanceName+"-extauthz-allow", cfg.ReleaseNamespace, ownerCM, labels, spec)
}

// applyAuthorizationPolicy creates or updates an Istio AuthorizationPolicy
// via the dynamic client. Mirrors the applyCertificate pattern.
func (r *InstanceReconciler) applyAuthorizationPolicy(ctx context.Context, desired *unstructured.Unstructured) error {
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
