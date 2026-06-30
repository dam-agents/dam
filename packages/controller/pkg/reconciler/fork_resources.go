package reconciler

import (
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

const (
	ForkJobLabelType  = "agent-fork-job"
	ForkLabelForkID   = "agent-platform.ai/fork-id"
	ForkLabelAgentRef = "agent-platform.ai/agent"
	ForkLabelType     = "agent-platform.ai/type"
)

// BuildForkAgentJob constructs the agent half of the per-turn paired pod
// pair. The fork agent runs the harness; egress credential
// injection happens in the paired fork gateway pod, reached via HTTPS_PROXY.
//
// `credentialSecrets` are the replier's `(owner=foreignSub, connection=*)`
// K8s Secrets — the instance owner's Secrets must NOT appear here. They mount
// only on the paired gateway pod. The agent container
// itself sees no Secret bytes.
//
// Forks deliberately do NOT receive `PLATFORM_POD_FILES_EVENTS_URL`, so the
// agent-runtime running in the fork pod skips the pod-files SSE loop
// entirely. Forks are short-lived ACP-relay jobs spawned per turn; the
// SSE overhead per pod isn't justified for that lifecycle.
func BuildForkAgentJob(
	forkName string,
	forkSpec *types.ForkSpec,
	agentSpec *types.AgentSpec,
	cfg *config.Config,
	ownerRef metav1.OwnerReference,
	credentialSecrets []corev1.Secret,
	gatewayClusterIP string,
) *batchv1.Job {
	// Fork agent opts out of ambient mesh, mirroring the long-lived agent
	// shape. NetworkPolicy at the kernel is the boundary; the fork gateway pod
	// remains a mesh participant for SPIFFE-keyed harness + ext-authz admission
	// via the per-fork AuthorizationPolicies, which admit the fork SA only to
	// `/api/agents/<parent>/mcp`.
	labels, tmpl := buildEphemeralAgentPod(ephemeralPodConfig{
		name:               forkName,
		parentAgentID:      forkSpec.AgentName,
		agentSpec:          agentSpec,
		cfg:                cfg,
		credentialSecrets:  credentialSecrets,
		gatewayClusterIP:   gatewayClusterIP,
		serviceAccountName: forkName,
		leafSecretName:     forkName,
		typeLabel:          ForkJobLabelType,
		idLabelKey:         ForkLabelForkID,
		extraEnv: []corev1.EnvVar{
			{Name: "PLATFORM_FORK_ID", Value: forkName},
			{Name: "PLATFORM_FOREIGN_SUB", Value: forkSpec.ForeignSub},
		},
	})

	ttl := int32(60)
	backoff := int32(0)
	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:            forkName,
			Namespace:       cfg.Namespace,
			Labels:          labels,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template:                tmpl,
		},
	}
}
