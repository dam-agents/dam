package reconciler

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// ADR-041: per-instance ext-authz Service. One Service per instance,
// pointing at the api-server pod, named `<release>-extauthz-<id>` in the
// release namespace. The gateway pod's Envoy bootstrap dials this Service;
// the per-instance AuthorizationPolicy on each Service ALLOWs only the
// matching instance's SA principal. Together, these replace the previous
// `x-platform-instance` header trust chain — instance identity becomes
// the K8s Service the gateway is configured to dial, cryptographically
// pinned to the per-instance SA via mesh policy.
//
// The Service lives in the *release* namespace (where api-server pods
// run), even though the matching SA lives in the *agent* namespace —
// AuthorizationPolicy `from.principals` carries the SA's namespace as
// part of the principal string, so this is unambiguous.

// BuildExtAuthzService renders the per-instance ext-authz Service.
//
// No OwnerReference: the owner instance CM lives in the agent namespace,
// but this Service lives in the release namespace; K8s ownerRef does not
// carry a namespace and assumes same-namespace, so a cross-namespace ref
// makes the K8s GC controller reap the Service as orphaned. Cleanup is
// label-driven instead — `instance.go Delete()` lists by `LabelInstance`
// and deletes by name on instance removal.
func BuildExtAuthzService(instanceName string, cfg *config.Config, _ *corev1.ConfigMap) *corev1.Service {
	extAuthzPort := portInt32(cfg.ExtAuthzPort)
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      cfg.ExtAuthzServiceName(instanceName),
			Namespace: cfg.ReleaseNamespace,
			Labels: map[string]string{
				LabelInstance:                  instanceName,
				"app.kubernetes.io/component":  "apiserver",
				"app.kubernetes.io/managed-by": "platform-controller",
			},
		},
		Spec: corev1.ServiceSpec{
			Type: corev1.ServiceTypeClusterIP,
			// Match the chart's selectorLabels (`app.kubernetes.io/instance` =
			// `.Release.Name`). `cfg.ReleaseName` carries `platform.fullname`
			// instead, which diverges from `.Release.Name` whenever the chart
			// name isn't a substring of the release name — using it here would
			// produce a selector that matches no pods, leaving the Service
			// with zero endpoints and envoy ext-authz returning "no healthy
			// upstream" (HTTP 403 with empty body).
			Selector: map[string]string{
				"app.kubernetes.io/component": "apiserver",
				"app.kubernetes.io/instance":  cfg.APIServerInstanceLabel,
			},
			Ports: []corev1.ServicePort{{
				Name:        "ext-authz",
				Port:        extAuthzPort,
				TargetPort:  intstr.FromString("ext-authz"),
				Protocol:    corev1.ProtocolTCP,
				AppProtocol: stringPtr("grpc"),
			}},
		},
	}
}

func stringPtr(s string) *string { return &s }

// applyExtAuthzService creates or reconciles the per-instance ext-authz
// Service. Spec.Selector and Ports are reconciled on drift; ClusterIP is
// preserved (immutable on Update).
func (r *InstanceReconciler) applyExtAuthzService(ctx context.Context, desired *corev1.Service) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.CoreV1().Services(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().Services(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		// ClusterIP is immutable; carry it forward.
		desired.Spec.ClusterIP = existing.Spec.ClusterIP
		desired.ResourceVersion = existing.ResourceVersion
		_, err = r.client.CoreV1().Services(desired.Namespace).Update(ctx, desired, metav1.UpdateOptions{})
		return err
	})
}
