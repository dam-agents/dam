package reconciler

import (
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Paired gateway pod (ADR-038). The gateway runs Envoy and is the only
// pod the paired agent can reach for TCP 80/443. Credential Secrets, the
// leaf TLS Secret, and the Envoy bootstrap ConfigMap mount here only —
// the agent pod has no path to Secret material.

// GatewayName returns the per-pair gateway pod / Service name.
func GatewayName(pairKey string) string {
	return pairKey + "-gateway"
}

// BuildGatewayStatefulSet renders the long-lived gateway StatefulSet paired
// with the agent StatefulSet of the same instance. Replicas track the agent's
// desired state (running → 1, hibernated → 0) so the pair scales as a unit.
//
// `instanceName` is both the pair key and the parent instance reference
// (long-lived pairs collapse the two).
func BuildGatewayStatefulSet(instanceName string, hibernated bool, cfg *config.Config, ownerCM *corev1.ConfigMap, credentialSecrets []corev1.Secret) *appsv1.StatefulSet {
	replicas := int32(1)
	if hibernated {
		replicas = 0
	}

	gatewayName := GatewayName(instanceName)
	labels := map[string]string{
		LabelInstance: instanceName,
		LabelPair:     instanceName,
		LabelRole:     RoleGateway,
	}

	volumes := envoyVolumes(instanceName, credentialSecrets)
	containers := []corev1.Container{envoyContainer(cfg, credentialSecrets)}

	falseVal := false

	annotations := map[string]string{
		// Roll trigger (ADR-035): hash of the Secret set driving the Envoy
		// bootstrap. When the api-server adds an allow-only Secret to promote
		// a host onto L7, the hash changes, the pod template diverges, and
		// the gateway StatefulSet rolls so Envoy picks up the new chain set
		// + leaf cert.
		"agent-platform.ai/envoy-secrets-rev": envoySecretsRev(credentialSecrets),
	}

	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      gatewayName,
			Namespace: cfg.Namespace,
			Labels:    labels,
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:    &replicas,
			ServiceName: gatewayName,
			Selector:    &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels:      labels,
					Annotations: annotations,
				},
				Spec: corev1.PodSpec{
					// ADR-041: gateway pod runs as the per-instance SA so
					// its SPIFFE workload identity matches the agent half
					// of the pair (same SA on both pods). The gateway-side
					// AuthorizationPolicy ALLOWs only this principal.
					ServiceAccountName:            instanceName,
					TerminationGracePeriodSeconds: &cfg.TerminationGracePeriod,
					AutomountServiceAccountToken:  &falseVal,
					Containers:                    containers,
					Volumes:                       volumes,
				},
			},
		},
	}
}

// BuildGatewayService is the headless Service the agent reaches via
// `HTTPS_PROXY`. Service-form is stable across gateway pod restarts; pod-DNS
// would tie the agent's env to a StatefulSet ordinal (ADR-038).
func BuildGatewayService(instanceName string, cfg *config.Config, ownerCM *corev1.ConfigMap) *corev1.Service {
	gatewayName := GatewayName(instanceName)
	envoyPort := portInt32(cfg.EnvoyPort)
	selector := map[string]string{LabelPair: instanceName, LabelRole: RoleGateway}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      gatewayName,
			Namespace: cfg.Namespace,
			Labels:    map[string]string{LabelInstance: instanceName, LabelPair: instanceName, LabelRole: RoleGateway},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  selector,
			Ports: []corev1.ServicePort{{
				Name:       "proxy",
				Port:       envoyPort,
				TargetPort: intstr.FromInt32(envoyPort),
			}},
		},
	}
}

// BuildForkGatewayPod renders the gateway pod for a fork. Forks use a bare
// Pod (not a StatefulSet) — there is exactly one fork pod ever, and the
// owner reference on the fork ConfigMap GCs the Pod when the fork CM is
// deleted (ADR-038).
//
// `parentInstanceID` flows into the `agent-platform.ai/instance` label so
// ext_authz Check calls from this gateway resolve under the parent
// instance's egress rules (ADR-027). The pair key is the fork's own name
// so the fork pair is structurally isolated from the parent instance pair.
func BuildForkGatewayPod(forkName, parentInstanceID string, cfg *config.Config, ownerCM *corev1.ConfigMap, credentialSecrets []corev1.Secret) *corev1.Pod {
	gatewayName := GatewayName(forkName)
	labels := map[string]string{
		LabelInstance: parentInstanceID,
		LabelPair:     forkName,
		LabelRole:     RoleGateway,
		ForkLabelType: ForkJobLabelType,
	}

	volumes := envoyVolumes(forkName, credentialSecrets)
	containers := []corev1.Container{envoyContainer(cfg, credentialSecrets)}

	falseVal := false

	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      gatewayName,
			Namespace: cfg.Namespace,
			Labels:    labels,
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: corev1.PodSpec{
			// ADR-041 + ADR-027: fork gateway pod runs as the per-fork SA
			// (its own identity, NOT the parent's). The per-fork
			// gateway-admission AuthorizationPolicy ALLOWs only this SA
			// (both pods of the fork pair share it), and per-fork
			// harness + ext-authz policies admit it to a narrow surface
			// scoped to the parent.
			ServiceAccountName:            forkName,
			RestartPolicy:                 corev1.RestartPolicyAlways,
			TerminationGracePeriodSeconds: &cfg.TerminationGracePeriod,
			AutomountServiceAccountToken:  &falseVal,
			Containers:                    containers,
			Volumes:                       volumes,
		},
	}
}

// BuildForkGatewayService gives the fork's agent Job a stable DNS name to
// point HTTPS_PROXY at, mirroring the long-lived shape.
func BuildForkGatewayService(forkName string, cfg *config.Config, ownerCM *corev1.ConfigMap) *corev1.Service {
	gatewayName := GatewayName(forkName)
	envoyPort := portInt32(cfg.EnvoyPort)
	selector := map[string]string{LabelPair: forkName, LabelRole: RoleGateway}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      gatewayName,
			Namespace: cfg.Namespace,
			Labels:    map[string]string{LabelPair: forkName, LabelRole: RoleGateway},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  selector,
			Ports: []corev1.ServicePort{{
				Name:       "proxy",
				Port:       envoyPort,
				TargetPort: intstr.FromInt32(envoyPort),
			}},
		},
	}
}

