package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

const (
	RunPodLabelType = "agent-run-pod"
	RunLabelRunID   = "agent-platform.ai/run-id"
)

// BuildRunExecutorPod constructs the executor behind a `dam-run` invocation: a
// bare Pod (lifetime owned by the api-server stream, not run-to-completion) that
// boots agent-runtime in exec-only mode and serves one command over /api/exec.
// It runs as the parent Agent's own owner and routes egress through the parent's
// *already-running* gateway — `parentGatewayIP` is the parent gateway Service's
// ClusterIP — so it needs no gateway/cert/SA/AuthorizationPolicy of its own; its
// own egress NetworkPolicy admits it to that gateway. Credentials reach it the
// same way forks get them: placeholder env (here) + on-wire injection at the
// shared gateway.
func BuildRunExecutorPod(
	runName string,
	parentAgentID string,
	agentSpec *types.AgentSpec,
	cfg *config.Config,
	ownerRef metav1.OwnerReference,
	credentialSecrets []corev1.Secret,
	parentGatewayIP string,
) *corev1.Pod {
	_, tmpl := buildEphemeralAgentPod(ephemeralPodConfig{
		name:              runName,
		parentAgentID:     parentAgentID,
		agentSpec:         agentSpec,
		cfg:               cfg,
		credentialSecrets: credentialSecrets,
		gatewayClusterIP:  parentGatewayIP,
		// No per-run SA — the executor isn't a mesh participant; its egress
		// identity is the parent gateway's. Default namespace SA, token off.
		serviceAccountName: "",
		// Trust the parent gateway's MITM leaf (ca.crt only).
		leafSecretName: parentAgentID,
		typeLabel:      RunPodLabelType,
		idLabelKey:     RunLabelRunID,
		extraEnv: []corev1.EnvVar{
			{Name: "PLATFORM_EXEC_ONLY", Value: "1"},
			{Name: "PLATFORM_RUN_ID", Value: runName},
		},
	})
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            runName,
			Namespace:       cfg.Namespace,
			Labels:          tmpl.ObjectMeta.Labels,
			Annotations:     tmpl.ObjectMeta.Annotations,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: tmpl.Spec,
	}
}
