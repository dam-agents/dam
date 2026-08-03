package reconciler

import (
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Paired gateway pod. The gateway runs Envoy and is the only
// pod the paired agent can reach for TCP 80/443. Credential Secrets, the
// leaf TLS Secret, and the Envoy bootstrap ConfigMap mount here only —
// the agent pod has no path to Secret material.
//
// Gateway pods are platform-managed: they do NOT inherit operator-facing
// agent config (controller.agent.*). Scheduling, metadata, and lifecycle
// are controller-internal — same category as `envoyImage`/`envoyPort`,
// which are platform-managed Envoy bootstrap concerns. The pair is paired
// at the Service-DNS level, so co-scheduling agent and gateway on the same
// node isn't a requirement.

// gatewayTerminationGracePeriod is Envoy's drain window. Hardcoded — Envoy's
// default drain is ~5s and there's nothing else in the pod that needs longer.
const gatewayTerminationGracePeriod int64 = 5

// GatewayName returns the per-pair gateway pod / Service name.
func GatewayName(pairKey string) string {
	return pairKey + "-gateway"
}

// BuildGatewayStatefulSet renders the long-lived gateway StatefulSet paired
// with the agent StatefulSet of the same agent. Replicas track the agent's
// desired state (running → 1, hibernated → 0) so the pair scales as a unit.
//
// `agentName` is both the pair key and the parent agent reference
// (long-lived pairs collapse the two).
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
		// Roll trigger: hash of the inputs driving the Envoy bootstrap.
		// When the api-server promotes a host onto L7 (spec.l7Hosts,
		// #2865), the hash changes, the pod template diverges, and the
		// gateway StatefulSet rolls so Envoy picks up the new chain set
		// + leaf cert. Per-agent grain: a sibling agent's rule never
		// changes this agent's hash.
		"agent-platform.ai/envoy-secrets-rev": envoySecretsRev(credentialSecrets, l7Hosts),
	}

	podSpec := corev1.PodSpec{
		// Gateway pod runs as the per-agent SA so that its SPIFFE
		// workload identity is `<td>/ns/<ns>/sa/<id>`. The agent half
		// of the pair has no SPIFFE (it opts out of ambient — see
		// resources.go), so the SA is effectively "the gateway's
		// identity"; the harness + ext-authz AuthorizationPolicies
		// admit this principal at the api-server end of the gateway →
		// api-server hops. The agent → gateway hop is gated at the
		// kernel by the per-pair NetworkPolicy.
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
			// Single-replica pair: there is no "graceful rolling"
			// to preserve. Default StatefulSet rollouts wait for the existing
			// pod to be Ready before replacing it, which deadlocks if the
			// pod is in CrashLoopBackOff (e.g. when the bootstrap CM was
			// updated to reference TLS chains while pod-0 still has the
			// rev-without-leaf-TLS-volume mounts). maxUnavailable: 1 lets
			// K8s evict the broken pod immediately so the new template can
			// roll out instead of getting stuck behind a NotReady pod.
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

// BuildGatewayService is the ClusterIP Service the agent reaches via
// `HTTPS_PROXY`. The auto-assigned virtual IP is what HTTPS_PROXY uses
// directly (IP-literal, no DNS) and what the iptables init container's
// allow-list / np-gate probe target. Was previously headless;
// `Service.Spec.ClusterIP == "None"` isn't usable as a literal target.
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
			// ClusterIP omitted → apiserver auto-assigns a stable IP.
			Selector: selector,
			Ports: []corev1.ServicePort{{
				Name:       "proxy",
				Port:       envoyPort,
				TargetPort: intstr.FromInt32(envoyPort),
			}},
		},
	}
}
