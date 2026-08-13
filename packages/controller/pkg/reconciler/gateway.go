package reconciler

import (
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const gatewayTerminationGracePeriod int64 = 5

func GatewayName(pairKey string) string {
	return pairKey + "-gateway"
}

func BuildGatewayStatefulSet(agentName string, hibernated bool, cfg *config.Config, ownerRef metav1.OwnerReference, credentialSecrets []corev1.Secret, l7Hosts []string) *appsv1.StatefulSet {
	replicas := int32(1)
	if hibernated {
		replicas = 0
	}

	gatewayName := GatewayName(agentName)
	labels := map[string]string{
		LabelAgent: agentName,
		LabelPair:  agentName,
		LabelRole:  RoleGateway,
	}

	volumes := envoyVolumes(agentName, cfg, credentialSecrets, l7Hosts)
	containers := []corev1.Container{envoyContainer(agentName, cfg, credentialSecrets, l7Hosts)}

	falseVal := false
	gracePeriod := gatewayTerminationGracePeriod

	annotations := map[string]string{
		// + leaf cert. Per-agent grain: a sibling agent's rule never
		"agent-platform.ai/envoy-secrets-rev": envoySecretsRev(credentialSecrets, l7Hosts),
	}

	podSpec := corev1.PodSpec{
		ServiceAccountName:            agentName,
		TerminationGracePeriodSeconds: &gracePeriod,
		AutomountServiceAccountToken:  &falseVal,
		Containers:                    containers,
		Volumes:                       volumes,
	}

	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:            gatewayName,
			Namespace:       cfg.Namespace,
			Labels:          labels,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:    &replicas,
			ServiceName: gatewayName,
			Selector:    &metav1.LabelSelector{MatchLabels: labels},
			UpdateStrategy: appsv1.StatefulSetUpdateStrategy{
				Type: appsv1.RollingUpdateStatefulSetStrategyType,
				RollingUpdate: &appsv1.RollingUpdateStatefulSetStrategy{
					MaxUnavailable: ptrIntOrString(intstr.FromInt(1)),
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels:      labels,
					Annotations: annotations,
				},
				Spec: podSpec,
			},
		},
	}
}

func ptrIntOrString(v intstr.IntOrString) *intstr.IntOrString { return &v }

func BuildGatewayService(agentName string, cfg *config.Config, ownerRef metav1.OwnerReference) *corev1.Service {
	gatewayName := GatewayName(agentName)
	envoyPort := portInt32(cfg.EnvoyPort)
	selector := map[string]string{LabelPair: agentName, LabelRole: RoleGateway}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:            gatewayName,
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: agentName, LabelPair: agentName, LabelRole: RoleGateway},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: corev1.ServiceSpec{
			Selector: selector,
			Ports: []corev1.ServicePort{{
				Name:       "proxy",
				Port:       envoyPort,
				TargetPort: intstr.FromInt32(envoyPort),
			}},
		},
	}
}
