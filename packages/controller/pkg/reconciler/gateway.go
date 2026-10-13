package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const gatewayTerminationGracePeriod int64 = 5

const annGatewayCredentialsRev = "agent-platform.ai/credentials-rev"

func GatewayName(pairKey string) string {
	return pairKey + "-gateway"
}

func BuildGatewayStatefulSet(agentName, owner string, hibernated bool, machineGatewayIP string, cfg *config.Config, ownerRef metav1.OwnerReference, credentialSecrets []corev1.Secret, l7Hosts []string, requireAddress bool) *appsv1.StatefulSet {
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
	if machineGatewayIP != "" {
		containers = append(containers, machineDNSContainer(cfg, machineGatewayIP))
	}

	falseVal := false
	gracePeriod := gatewayTerminationGracePeriod

	podLabels := map[string]string{envoyOwnerLabel: owner}
	for k, v := range labels {
		podLabels[k] = v
	}

	annotations := map[string]string{
		// + leaf cert. Per-agent grain: a sibling agent's rule never
		"agent-platform.ai/envoy-secrets-rev": envoyGatewayRev(cfg, credentialSecrets, l7Hosts, requireAddress),
	}

	podSpec := corev1.PodSpec{
		ServiceAccountName:            agentName,
		TerminationGracePeriodSeconds: &gracePeriod,
		AutomountServiceAccountToken:  &falseVal,
		EnableServiceLinks:            &falseVal,
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
					MaxUnavailable: new(intstr.FromInt(1)),
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels:      podLabels,
					Annotations: annotations,
				},
				Spec: podSpec,
			},
		},
	}
}

func BuildGatewayService(agentName string, vm bool, cfg *config.Config, ownerRef metav1.OwnerReference) *corev1.Service {
	gatewayName := GatewayName(agentName)
	envoyPort := portInt32(cfg.EnvoyPort)
	selector := map[string]string{LabelPair: agentName, LabelRole: RoleGateway}
	ports := []corev1.ServicePort{{
		Name:       "proxy",
		Port:       envoyPort,
		TargetPort: intstr.FromInt32(envoyPort),
	}}
	if vm {
		ports = append(ports, machineGatewayServicePorts(cfg)...)
	}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:            gatewayName,
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: agentName, LabelPair: agentName, LabelRole: RoleGateway},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: corev1.ServiceSpec{
			Selector: selector,
			Ports:    ports,
		},
	}
}

func gatewayCredentialsRev(secrets []corev1.Secret) string {
	h := sha256.New()
	for _, s := range secrets {
		if s.Labels[envoySecretTypeLabel] != envoySecretTypeAllowOnly {
			fmt.Fprintf(h, "%s@%s\n", s.Name, s.ResourceVersion)
		}
	}
	return hex.EncodeToString(h.Sum(nil)[:8])
}

// UNIT_BOUNDARY_DESCRIPTION: a credential rewritten in place reaches the gateway's mounted files only when the kubelet next syncs the pod, which on its own is the periodic sync about a minute later. Any change to a pod's annotations makes the kubelet sync it at once and refresh its Secret volumes, so the gateway pod carries the resource versions of the credential Secrets it mounts, and a rotation changes them. The pod's spec and its StatefulSet's template stay as they are, so nothing restarts.
func (r *AgentReconciler) refreshGatewayCredentials(ctx context.Context, ssName string, secrets []corev1.Secret) error {
	pod, err := r.readPod(ctx, ssName)
	if err != nil || pod == nil || pod.DeletionTimestamp != nil {
		return err
	}
	rev := gatewayCredentialsRev(secrets)
	if pod.Annotations[annGatewayCredentialsRev] == rev {
		return nil
	}
	patch := fmt.Sprintf(`{"metadata":{"annotations":{%q:%q}}}`, annGatewayCredentialsRev, rev)
	_, err = r.client.CoreV1().Pods(pod.Namespace).Patch(ctx, pod.Name, types.MergePatchType, []byte(patch), metav1.PatchOptions{})
	return err
}
