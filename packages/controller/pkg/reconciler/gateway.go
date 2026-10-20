package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const gatewayTerminationGracePeriod int64 = 5

const (
	annGatewayCredentialsRev     = "agent-platform.ai/credentials-rev"
	annGatewayCredentialsTouched = "agent-platform.ai/credentials-touched"
	annGatewayCredentialsResync  = "agent-platform.ai/credentials-resync"
	gatewayCredentialsResyncWait = 5 * time.Second
)

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
func (r *AgentReconciler) refreshGatewayCredentials(ctx context.Context, ssName string, secrets []corev1.Secret, now time.Time) (time.Duration, error) {
	pod, err := r.readPod(ctx, ssName)
	if err != nil || pod == nil || pod.DeletionTimestamp != nil {
		return 0, err
	}
	return r.nudgeCredentialSync(ctx, pod, gatewayCredentialsRev(secrets), now)
}

// UNIT_BOUNDARY_DESCRIPTION: the kubelet refreshes a Secret volume from its own copy of the Secret, which a watch keeps current, so the sync one annotation change causes can come before that copy has the new version, and the old value then stays until the periodic sync. So a gateway pod is synced twice for each revision: once when the revision changes, and once more a few seconds later, by a second annotation, when the kubelet's copy has caught up. A pod that carries no revision yet mounted its Secrets when it started, so it takes both at once and needs no second sync. The first change also records when it was made, so the second waits the same time after a controller restart, and the returned delay is when to come back for it. A revision both changes have seen writes nothing, so the pod updates this causes do not loop the reconcile.
func (r *AgentReconciler) nudgeCredentialSync(ctx context.Context, pod *corev1.Pod, rev string, now time.Time) (time.Duration, error) {
	var annotations map[string]string
	var recheck time.Duration
	switch {
	case pod.Annotations[annGatewayCredentialsRev] == "":
		annotations = map[string]string{annGatewayCredentialsRev: rev, annGatewayCredentialsResync: rev}
	case pod.Annotations[annGatewayCredentialsRev] != rev:
		annotations = map[string]string{annGatewayCredentialsRev: rev, annGatewayCredentialsTouched: now.UTC().Format(time.RFC3339Nano)}
		recheck = gatewayCredentialsResyncWait
	case pod.Annotations[annGatewayCredentialsResync] != rev:
		touched, _ := time.Parse(time.RFC3339Nano, pod.Annotations[annGatewayCredentialsTouched])
		if wait := touched.Add(gatewayCredentialsResyncWait).Sub(now); wait > 0 {
			return wait, nil
		}
		annotations = map[string]string{annGatewayCredentialsResync: rev}
	default:
		return 0, nil
	}
	patch, err := json.Marshal(map[string]any{"metadata": map[string]any{"annotations": annotations}})
	if err != nil {
		return 0, err
	}
	if _, err := r.client.CoreV1().Pods(pod.Namespace).Patch(ctx, pod.Name, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
		return 0, err
	}
	return recheck, nil
}
