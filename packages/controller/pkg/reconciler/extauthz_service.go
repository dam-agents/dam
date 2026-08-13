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

func BuildExtAuthzService(agentName string, cfg *config.Config) *corev1.Service {
	extAuthzPort := portInt32(cfg.ExtAuthzPort)
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      cfg.ExtAuthzServiceName(agentName),
			Namespace: cfg.ReleaseNamespace,
			Labels: map[string]string{
				LabelAgent:                     agentName,
				"app.kubernetes.io/component":  "apiserver",
				"app.kubernetes.io/managed-by": "platform-controller",
			},
		},
		Spec: corev1.ServiceSpec{
			Type: corev1.ServiceTypeClusterIP,
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

func (r *AgentReconciler) applyExtAuthzService(ctx context.Context, desired *corev1.Service) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.CoreV1().Services(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().Services(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		desired.Spec.ClusterIP = existing.Spec.ClusterIP
		desired.ResourceVersion = existing.ResourceVersion
		_, err = r.client.CoreV1().Services(desired.Namespace).Update(ctx, desired, metav1.UpdateOptions{})
		return err
	})
}
