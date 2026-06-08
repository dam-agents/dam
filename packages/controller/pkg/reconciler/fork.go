package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	cmv1 "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

const ForkPodReadyTimeout = 120 * time.Second

type ForkReconciler struct {
	client   kubernetes.Interface
	dynamic  dynamic.Interface // required to apply per-fork cert-manager Certificates
	config   *config.Config
	resolver *AgentResolver
	now      func() time.Time
}

func NewForkReconciler(client kubernetes.Interface, cfg *config.Config, resolver *AgentResolver) *ForkReconciler {
	return &ForkReconciler{client: client, config: cfg, resolver: resolver, now: time.Now}
}

// WithDynamicClient supplies a dynamic client used to apply the cert-manager
// Certificate that backs the per-fork Envoy leaf TLS Secret.
func (r *ForkReconciler) WithDynamicClient(d dynamic.Interface) *ForkReconciler {
	r.dynamic = d
	return r
}

func (r *ForkReconciler) Reconcile(ctx context.Context, fork *apiv1.Fork) error {
	forkName := fork.Name
	ownerRef := forkOwnerRef(fork)

	currentPhase := fork.Status.Phase
	if currentPhase == apiv1.ForkPhaseFailed || currentPhase == apiv1.ForkPhaseCompleted {
		return nil
	}

	// ADR-058: K8s validated the spec at admission, so the controller trusts
	// the typed resource — no app-layer re-parse.
	forkSpec := &fork.Spec

	// ADR-046: the fork derives from a single Agent that carries both
	// definition and runtime fields. Resolve it directly.
	_, agentSpec, err := r.resolver.Resolve(forkSpec.AgentName)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	// Load the replier's K8s credential Secrets and render the per-fork
	// bootstrap ConfigMap + leaf certificate. Secrets are scoped to
	// `foreignSub` — the parent owner's secrets must NOT appear here
	// (ADR-033 §"Fork-Job pods follow the replier"). The per-fork
	// bootstrap/leaf names are derived from `forkName`, so the resources
	// are owned by the fork ConfigMap and GC'd with it.
	credentialSecrets, err := listOwnerCredentialSecrets(ctx, r.client, r.config.Namespace, forkSpec.ForeignSub)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("listing replier credential secrets: %v", err))
	}

	if !hasGHTokenEnv(credentialSecrets) {
		slog.Warn("fork: replier has no GitHub credential Secret; gh/octokit calls will be unauthenticated",
			"fork", forkName, "foreignSub", forkSpec.ForeignSub)
	}

	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(forkName, forkSpec.AgentName, r.config, ownerRef, credentialSecrets)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("rendering envoy bootstrap: %v", err))
	}
	if err := r.applyConfigMap(ctx, bootstrapCM); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying envoy bootstrap: %v", err))
	}
	// Forks keep the credential-gated leaf (ephemeral; out of no-roll scope).
	if cert := BuildEnvoyLeafCertificate(forkName, r.config, ownerRef, credentialSecrets, false); cert != nil {
		if err := r.applyCertificate(ctx, cert); err != nil {
			return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying envoy leaf certificate: %v", err))
		}
	}

	// ADR-041: per-fork ServiceAccount in the agent namespace. Forks get
	// their OWN identity (not the parent's) so a compromised fork cannot
	// reach the parent's full `/api/agents/<parent>/*` surface — only
	// the narrow paths the per-fork harness AuthorizationPolicy below
	// admits. Owner-refed to the fork ConfigMap (same namespace), so
	// K8s GC reaps it on fork-cm delete.
	if err := r.ensureForkServiceAccount(ctx, forkName, ownerRef); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	// ADR-027: per-fork harness policy admits the fork SA only to
	// `/api/agents/<parent>/mcp` (not the parent's full surface), and
	// the per-fork ext-authz policy admits the fork SA to the parent's
	// per-agent ext-authz Service so the parent owner's HITL rules
	// continue to gate the fork's egress. Both gate the fork *gateway*'s
	// SPIFFE identity — the fork agent itself is not a mesh participant.
	if err := r.applyAuthorizationPolicy(ctx, BuildForkHarnessAuthorizationPolicy(forkName, forkSpec.AgentName, r.config, fork.Namespace, ownerRef)); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying fork harness authz policy: %v", err))
	}
	if err := r.applyAuthorizationPolicy(ctx, BuildForkExtAuthzAuthorizationPolicy(forkName, forkSpec.AgentName, r.config, fork.Namespace, ownerRef)); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying fork ext-authz authz policy: %v", err))
	}

	// Per-pair agent egress NetworkPolicy — same shape and rationale as
	// the long-lived pair: kernel-level boundary gating the agent → fork
	// gateway hop, agent has no ambient enrolment.
	if err := r.applyAgentEgressNetworkPolicy(ctx, BuildAgentEgressNetworkPolicy(forkName, r.config, ownerRef)); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	// ADR-038: paired gateway pod for the fork. Render the gateway-side
	// resources first so HTTPS_PROXY's target exists by the time the
	// agent Job's pod starts dialing it. ADR-041: pair-key NetworkPolicy
	// is gone — pair isolation is now enforced by the AuthorizationPolicy
	// above.
	gatewayPod := BuildForkGatewayPod(forkName, forkSpec.AgentName, r.config, ownerRef, credentialSecrets)
	gatewaySvc := BuildForkGatewayService(forkName, r.config, ownerRef)

	if err := r.applyPod(ctx, gatewayPod); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying gateway pod: %v", err))
	}
	// Apply gateway Service + migrate any legacy headless, capture
	// ClusterIP synchronously (see instance.go).
	liveGatewaySvc, err := ensureGatewayService(ctx, r.client, gatewaySvc, "fork", forkName)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("ensuring gateway service: %v", err))
	}
	gatewayIP := liveGatewaySvc.Spec.ClusterIP

	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("fork %s: gateway Service ClusterIP not yet assigned, requeuing", forkName)
	}

	desired := BuildForkAgentJob(forkName, forkSpec, agentSpec, r.config, ownerRef, credentialSecrets, gatewayIP)
	// #692: a warm-pool-claimed parent workspace PVC no longer follows the
	// `<mount>-<agent>-0` name BuildForkAgentJob assumes. Resolve each persisted
	// mount's PVC by label and rewrite the fork's claim refs (no-op for
	// pre-label agents — resolution falls back to the legacy name).
	parentPVCs, err := r.resolveParentWorkspacePVCs(ctx, forkSpec.AgentName, agentSpec)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("resolving parent workspace PVCs: %v", err))
	}
	applyForkParentPVCs(desired, parentPVCs)

	if err := r.applyForkJob(ctx, desired); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying job: %v", err))
	}

	job, err := r.client.BatchV1().Jobs(r.config.Namespace).Get(ctx, forkName, metav1.GetOptions{})
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("reading job: %v", err))
	}

	if isJobFailed(job) {
		return r.setForkFailed(ctx, forkName, types.ForkReasonPodNotReady, jobFailureReason(job))
	}

	pod, _ := r.findForkPod(ctx, forkName)
	if pod != nil && isPodReady(*pod) && pod.Status.PodIP != "" {
		return writeForkStatus(ctx, r.dynamic, r.config.Namespace, forkName, apiv1.ForkStatus{
			Phase: apiv1.ForkPhaseReady, JobName: forkName, PodIP: pod.Status.PodIP,
		})
	}

	if age := r.now().Sub(fork.CreationTimestamp.Time); age > ForkPodReadyTimeout {
		return r.setForkFailed(ctx, forkName, types.ForkReasonTimeout,
			fmt.Sprintf("pod not Ready after %s", ForkPodReadyTimeout))
	}

	if currentPhase == "" {
		return writeForkStatus(ctx, r.dynamic, r.config.Namespace, forkName, apiv1.ForkStatus{
			Phase: apiv1.ForkPhasePending, JobName: forkName,
		})
	}
	return nil
}

func (r *ForkReconciler) Delete(ctx context.Context, name string) {
	// Agent-namespace resources (ServiceAccount, gateway Pod, agent Job,
	// gateway Service, agent-egress NetworkPolicy, Envoy bootstrap CM,
	// leaf Cert) are owner-refed to the fork ConfigMap and reaped by K8s GC.
	//
	// Release-namespace per-fork policies (harness-allow, ext-authz-allow)
	// cannot use a cross-namespace ownerRef — same trap as the per-agent
	// resources in AgentReconciler.Delete. Clean them up explicitly.
	r.deleteReleaseNsForkResources(ctx, name)
	slog.Info("fork configmap deleted", "fork", name)
}

// deleteReleaseNsForkResources removes the per-fork harness + ext-authz
// AuthorizationPolicies the fork reconciler renders in the release
// namespace. Errors are logged but not returned — fork deletion is
// best-effort.
func (r *ForkReconciler) deleteReleaseNsForkResources(ctx context.Context, forkName string) {
	if r.dynamic == nil {
		return
	}
	for _, name := range []string{forkName + "-harness-allow", forkName + "-extauthz-allow"} {
		if err := r.dynamic.Resource(authzPolicyGVR).Namespace(r.config.ReleaseNamespace).
			Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			slog.Warn("deleting per-fork AuthorizationPolicy", "policy", name, "fork", forkName, "error", err)
		}
	}
}

// ensureForkServiceAccount renders the per-fork ServiceAccount and applies
// it idempotently. Mirrors AgentReconciler.ensureServiceAccount (same
// SA shape — `automountServiceAccountToken: false`, owner-refed to the
// fork ConfigMap, label-drift heal).
func (r *ForkReconciler) ensureForkServiceAccount(ctx context.Context, forkName string, ownerRef metav1.OwnerReference) error {
	sa := BuildServiceAccount(forkName, r.config, ownerRef)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.CoreV1().ServiceAccounts(sa.Namespace).Get(ctx, sa.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().ServiceAccounts(sa.Namespace).Create(ctx, sa, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		// Reconcile fields we own; preserve everything else.
		changed := false
		if existing.Labels == nil {
			existing.Labels = map[string]string{}
		}
		for k, v := range sa.Labels {
			if existing.Labels[k] != v {
				existing.Labels[k] = v
				changed = true
			}
		}
		if !hasOwnerRef(existing.OwnerReferences, sa.OwnerReferences[0]) {
			existing.OwnerReferences = append(existing.OwnerReferences, sa.OwnerReferences[0])
			changed = true
		}
		if existing.AutomountServiceAccountToken == nil ||
			*existing.AutomountServiceAccountToken != *sa.AutomountServiceAccountToken {
			existing.AutomountServiceAccountToken = sa.AutomountServiceAccountToken
			changed = true
		}
		if !changed {
			return nil
		}
		_, err = r.client.CoreV1().ServiceAccounts(sa.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

func (r *ForkReconciler) setForkFailed(ctx context.Context, name, reason, detail string) error {
	if err := writeForkStatus(ctx, r.dynamic, r.config.Namespace, name, apiv1.ForkStatus{
		Phase: apiv1.ForkPhaseFailed,
		Error: &apiv1.ForkError{Reason: reason, Detail: detail},
	}); err != nil {
		slog.Error("writing fork failed status", "fork", name, "error", err)
	}
	return fmt.Errorf("fork %s: %s: %s", name, reason, detail)
}

// resolveParentWorkspacePVCs maps each persisted mount of the parent Agent to
// the PVC name backing it, looked up by (agent, mount) label so a warm-pool
// workspace — whose name is the pool's generated name, not the
// `<mount>-<agent>-0` convention — resolves correctly (#692). For agents created
// before the mount label existed, no labeled PVC is found and it falls back to
// the legacy convention name, which is still the real name for those.
func (r *ForkReconciler) resolveParentWorkspacePVCs(ctx context.Context, parentAgent string, agentSpec *types.AgentSpec) (map[string]string, error) {
	out := map[string]string{}
	for _, m := range resolveSpecMounts(agentSpec, r.config.AgentTemplateDefaults) {
		if !m.Persist {
			continue
		}
		volName := types.SanitizeMountName(m.Path)
		list, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: LabelAgent + "=" + parentAgent + "," + LabelMount + "=" + volName,
		})
		if err != nil {
			return nil, err
		}
		if len(list.Items) > 0 {
			out[volName] = list.Items[0].Name
		} else {
			out[volName] = fmt.Sprintf("%s-%s-0", volName, parentAgent)
		}
	}
	return out, nil
}

func (r *ForkReconciler) applyForkJob(ctx context.Context, desired *batchv1.Job) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		_, err := r.client.BatchV1().Jobs(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.BatchV1().Jobs(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		return err
	})
}

// applyPod creates the fork's gateway Pod if missing. Bare Pods are immutable
// in their key fields (image, args, volumes), so we treat existing Pods as
// authoritative — a re-render with the same fork name keeps the running pod.
// Owner references on the Pod GC it when the fork CM is deleted.
func (r *ForkReconciler) applyPod(ctx context.Context, desired *corev1.Pod) error {
	_, err := r.client.CoreV1().Pods(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = r.client.CoreV1().Pods(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	return err
}

func (r *ForkReconciler) findForkPod(ctx context.Context, forkName string) (*corev1.Pod, error) {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s", ForkLabelForkID, forkName),
	})
	if err != nil {
		return nil, err
	}
	for i := range pods.Items {
		p := pods.Items[i]
		if p.DeletionTimestamp == nil {
			return &p, nil
		}
	}
	return nil, nil
}

func isPodReady(pod corev1.Pod) bool {
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func isJobFailed(job *batchv1.Job) bool {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobFailed && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func jobFailureReason(job *batchv1.Job) string {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobFailed && c.Status == corev1.ConditionTrue {
			if c.Message != "" {
				return c.Message
			}
			return c.Reason
		}
	}
	return "job failed"
}

// applyConfigMap mirrors `AgentReconciler.applyConfigMap` for fork-scoped
// ConfigMaps (Envoy bootstrap). Owner references on `desired` cause the CM to
// be GC'd when the fork CM is deleted.
func (r *ForkReconciler) applyConfigMap(ctx context.Context, desired *corev1.ConfigMap) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.CoreV1().ConfigMaps(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().ConfigMaps(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		existing.Data = desired.Data
		existing.OwnerReferences = desired.OwnerReferences
		existing.Labels = desired.Labels
		_, err = r.client.CoreV1().ConfigMaps(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

// applyAuthorizationPolicy mirrors `AgentReconciler.applyAuthorizationPolicy`
// for fork-scoped policies (per-fork gateway admission, ADR-041).
func (r *ForkReconciler) applyAuthorizationPolicy(ctx context.Context, desired *unstructured.Unstructured) error {
	if r.dynamic == nil {
		return fmt.Errorf("dynamic client not configured (AuthorizationPolicy cannot be applied)")
	}
	cli := r.dynamic.Resource(authzPolicyGVR).Namespace(desired.GetNamespace())
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

// applyCertificate mirrors `AgentReconciler.applyCertificate` for fork-scoped
// cert-manager Certificates (Envoy leaf TLS).
func (r *ForkReconciler) applyCertificate(ctx context.Context, desired *cmv1.Certificate) error {
	if r.dynamic == nil {
		return fmt.Errorf("dynamic client not configured (cert-manager Certificate cannot be applied)")
	}
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(desired)
	if err != nil {
		return fmt.Errorf("encoding Certificate: %w", err)
	}
	desiredU := &unstructured.Unstructured{Object: raw}
	desiredU.SetAPIVersion(cmv1.SchemeGroupVersion.String())
	desiredU.SetKind("Certificate")
	cli := r.dynamic.Resource(certificateGVR).Namespace(desired.Namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = cli.Create(ctx, desiredU, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		desiredU.SetResourceVersion(existing.GetResourceVersion())
		_, err = cli.Update(ctx, desiredU, metav1.UpdateOptions{})
		return err
	})
}
