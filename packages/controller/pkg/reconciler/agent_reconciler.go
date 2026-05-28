package reconciler

import (
	"context"
	"fmt"

	cmv1 "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"
	"log/slog"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// AgentReconciler owns the merged Agent ConfigMap (ADR-046). Each Agent CM
// (`agent-platform.ai/type=agent`) is the sole runtime resource per agent;
// the controller renders the agent + gateway StatefulSets, paired Services,
// per-agent SA / ext-authz Service / AuthorizationPolicies, and the egress
// NetworkPolicy from the merged spec.
type AgentReconciler struct {
	client  kubernetes.Interface
	dynamic dynamic.Interface // required to apply cert-manager Certificates
	config  *config.Config
}

func NewAgentReconciler(client kubernetes.Interface, cfg *config.Config) *AgentReconciler {
	return &AgentReconciler{client: client, config: cfg}
}

// WithDynamicClient supplies a dynamic client used to apply cert-manager.io/v1
// Certificate resources for the per-agent Envoy leaf TLS Secret.
func (r *AgentReconciler) WithDynamicClient(d dynamic.Interface) *AgentReconciler {
	r.dynamic = d
	return r
}

func (r *AgentReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	name := cm.Name

	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return r.setError(ctx, name, "no spec.yaml in ConfigMap")
	}
	agentSpec, err := types.ParseAgentSpec(specYAML)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// ADR-046: the Agent CM is self-contained — its `agent-platform.ai/owner`
	// label scopes credential Secret discovery directly. There's no separate
	// Agent definition CM to resolve against anymore.
	owner := cm.Labels["agent-platform.ai/owner"]
	credentialSecrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, owner, cm)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("listing credential secrets: %v", err))
	}

	if !hasGHTokenEnv(credentialSecrets) {
		slog.Warn("no GitHub credential Secret attached — gh/octokit calls will be unauthenticated",
			"agent", name, "owner", owner)
	}

	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(name, name, r.config, cm, credentialSecrets)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("rendering envoy bootstrap: %v", err))
	}
	if err := r.applyConfigMap(ctx, bootstrapCM); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying envoy bootstrap: %v", err))
	}
	if cert := BuildEnvoyLeafCertificate(name, r.config, cm, credentialSecrets); cert != nil {
		if err := r.applyCertificate(ctx, cert); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("applying envoy leaf certificate: %v", err))
		}
		// cert-manager's default mode does not set an OwnerReference on the
		// Secret it produces from a Certificate (the global flag
		// --enable-certificate-owner-ref controls that and we don't require
		// it), so deleting the Certificate alone leaves the Secret behind.
		// Patch the produced Secret with an OwnerReference back to the
		// agent ConfigMap so K8s GC cascade-deletes it with the agent.
		if err := r.ensureLeafSecretOwnerReference(ctx, name, cm); err != nil {
			slog.Warn("setting owner ref on envoy leaf TLS Secret; will retry on next reconcile",
				"agent", name, "error", err)
		}
	}

	// ADR-041: per-agent SA must exist before the agent + gateway pods
	// start (kubelet rejects pod scheduling on a missing SA, and Istio
	// stamps the SPIFFE workload cert from it).
	if err := r.ensureServiceAccount(ctx, name, cm); err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// ADR-041: per-agent ext-authz Service in the release namespace —
	// the gateway pod's Envoy bootstrap dials this Service for HITL
	// approvals, and the per-agent AuthorizationPolicy below pins it
	// to the matching SA principal.
	extAuthzSvc := BuildExtAuthzService(name, r.config, cm)
	if err := r.applyExtAuthzService(ctx, extAuthzSvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz service: %v", err))
	}

	// Two per-agent AuthorizationPolicies in the release namespace —
	// harness path-prefix at the waypoint, ext-authz Service principal.
	// Both gate the *gateway pod*'s SPIFFE identity (the only pod of the
	// pair that's a mesh participant). The agent → gateway hop is gated
	// by the agent-egress NetworkPolicy below, not by mesh AuthZ.
	if err := r.applyAuthorizationPolicy(ctx, BuildHarnessAuthorizationPolicy(name, r.config, cm)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying harness authz policy: %v", err))
	}
	if err := r.applyAuthorizationPolicy(ctx, BuildExtAuthzAuthorizationPolicy(name, r.config, cm)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz authz policy: %v", err))
	}

	// Per-pair agent egress NetworkPolicy. Agent pods opt out of ambient
	// mesh, so kernel NP is the only thing gating agent egress; it admits
	// DNS and the paired gateway pod's Envoy port, nothing else. The
	// gateway's Envoy ext_authz filter (ADR-035) gates which destinations
	// the agent's HTTPS_PROXY traffic reaches past the gateway.
	if err := r.applyAgentEgressNetworkPolicy(ctx, BuildAgentEgressNetworkPolicy(name, r.config, cm)); err != nil {
		return r.setError(ctx, name, err.Error())
	}

	hibernated := agentSpec.DesiredState == "hibernated"

	// ADR-038: paired pods, rendered as a unit. Render the gateway first
	// so the agent's HTTPS_PROXY target exists by the time the agent pod
	// starts dialing it. ADR-041: pair-key NetworkPolicies are gone —
	// pair isolation is now enforced by the per-agent AuthorizationPolicy
	// on the gateway Service (mesh-level, cryptographic).
	gatewaySS := BuildGatewayStatefulSet(name, hibernated, r.config, cm, credentialSecrets)
	gatewaySvc := BuildGatewayService(name, r.config, cm)

	if err := r.applyStatefulSet(ctx, gatewaySS); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying gateway statefulset: %v", err))
	}
	// The gateway pair is single-replica and may legitimately CrashLoop on a
	// stale revision (e.g. when grants land after agent creation: rev-1 has
	// no leaf TLS volume but kubelet refreshes the bootstrap CM in place,
	// so the live pod ends up reading rev-2 config against rev-1 volumes).
	// Default StatefulSet rolling-update semantics refuse to evict a
	// NotReady pod, deadlocking the rollout. The MaxUnavailableStatefulSet
	// gate fixes this upstream but isn't always enabled (k3s ≤ 1.35
	// disables it by default), so we do the eviction ourselves: delete any
	// gateway pod stuck on the old revision so the StatefulSet recreates
	// it at updateRevision.
	if err := r.forceRollStuckPod(ctx, gatewaySS.Namespace, gatewaySS.Name); err != nil {
		slog.Warn("force-rolling stuck gateway pod failed; rollout may be deadlocked",
			"namespace", gatewaySS.Namespace, "statefulset", gatewaySS.Name, "error", err)
	}
	// Apply gateway Service + migrate any legacy headless instance, return
	// the live object so we capture the assigned ClusterIP synchronously.
	liveGatewaySvc, err := ensureGatewayService(ctx, r.client, gatewaySvc, "agent", name)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("ensuring gateway service: %v", err))
	}
	gatewayIP := liveGatewaySvc.Spec.ClusterIP

	// HTTPS_PROXY + init containers all need the gateway ClusterIP;
	// requeue until it's assigned.
	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("agent %s: gateway Service ClusterIP not yet assigned, requeuing", name)
	}

	agentSS := BuildAgentStatefulSet(name, agentSpec, r.config, cm, credentialSecrets, gatewayIP)
	agentSvc := BuildAgentService(name, r.config, cm)
	if err := r.applyStatefulSet(ctx, agentSS); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying agent statefulset: %v", err))
	}
	if err := r.applyService(ctx, agentSvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying agent service: %v", err))
	}

	state := agentSpec.DesiredState
	if state == "" {
		state = "running"
	}
	return WriteAgentStatus(ctx, r.client, r.config.Namespace, name, types.NewAgentStatus(state, ""))
}

// ensureLeafSecretOwnerReference adds a non-controller OwnerReference from
// the cert-manager-produced envoy leaf TLS Secret to the agent CM, so
// that deleting the agent cascade-deletes the Secret. Returns nil if
// the Secret does not exist yet (cert-manager has not finished issuing —
// the next reconcile will retry).
func (r *AgentReconciler) ensureLeafSecretOwnerReference(ctx context.Context, agentName string, agentCM *corev1.ConfigMap) error {
	secretName := EnvoyLeafSecretName(agentName)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		sec, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, secretName, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		for _, ref := range sec.OwnerReferences {
			if ref.UID == agentCM.UID {
				return nil
			}
		}
		sec.OwnerReferences = append(sec.OwnerReferences, metav1.OwnerReference{
			APIVersion: "v1",
			Kind:       "ConfigMap",
			Name:       agentCM.Name,
			UID:        agentCM.UID,
		})
		_, err = r.client.CoreV1().Secrets(r.config.Namespace).Update(ctx, sec, metav1.UpdateOptions{})
		return err
	})
}

func (r *AgentReconciler) Delete(ctx context.Context, name string) {
	// Owner references in the agent namespace cascade-delete agent +
	// gateway StatefulSets, the agent + gateway Services, the per-agent
	// ServiceAccount, the per-pair agent egress NetworkPolicy, the Envoy
	// bootstrap ConfigMap, and the cert-manager Certificate / leaf Secret.
	//
	// Release-namespace resources (per-agent ext-authz Service, harness
	// + ext-authz AuthorizationPolicies) cannot use a cross-namespace
	// ownerRef — K8s assumes same-namespace ownerRefs and the GC controller
	// reaps them as orphans. Clean up explicitly.
	r.deleteReleaseNsAgentResources(ctx, name)

	// PVCs created via VolumeClaimTemplates on the agent StatefulSet are
	// intentionally NOT cascade-deleted by K8s (to prevent data loss).
	// We clean them up explicitly here.
	r.deletePVCs(ctx, name)
}

// deleteReleaseNsAgentResources deletes the release-namespace resources
// the controller renders for this agent: the per-agent ext-authz
// Service and the two AuthorizationPolicies (harness + ext-authz). Errors
// are logged but not returned — agent deletion best-effort proceeds.
func (r *AgentReconciler) deleteReleaseNsAgentResources(ctx context.Context, agentName string) {
	svcName := r.config.ExtAuthzServiceName(agentName)
	if err := r.client.CoreV1().Services(r.config.ReleaseNamespace).Delete(ctx, svcName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		slog.Warn("deleting per-agent ext-authz Service", "service", svcName, "agent", agentName, "error", err)
	}
	if r.dynamic == nil {
		return
	}
	for _, name := range []string{agentName + "-harness-allow", agentName + "-extauthz-allow"} {
		if err := r.dynamic.Resource(authzPolicyGVR).Namespace(r.config.ReleaseNamespace).
			Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			slog.Warn("deleting per-agent AuthorizationPolicy", "policy", name, "agent", agentName, "error", err)
		}
	}
}

func (r *AgentReconciler) deletePVCs(ctx context.Context, agentName string) {
	pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
		metav1.ListOptions{LabelSelector: LabelAgent + "=" + agentName},
	)
	if err != nil {
		slog.Warn("listing PVCs for agent", "agent", agentName, "error", err)
		return
	}
	for _, pvc := range pvcs.Items {
		if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil {
			slog.Warn("deleting PVC", "pvc", pvc.Name, "agent", agentName, "error", err)
		}
	}
}

// ReconcileOrphanPVCs deletes any PVC labeled `agent-platform.ai/agent=<name>` whose
// agent ConfigMap no longer exists. Covers two leak modes (issue #244):
// the controller crashing between StatefulSet teardown and PVC deletion, and
// users removing the agent ConfigMap out-of-band (e.g. via kubectl).
//
// Safe against the create-PVC-before-finalize race because we re-read the
// ConfigMap from the API server (not the informer cache) before deleting.
func (r *AgentReconciler) ReconcileOrphanPVCs(ctx context.Context) {
	pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
		metav1.ListOptions{LabelSelector: LabelAgent},
	)
	if err != nil {
		slog.Warn("orphan PVC GC: listing PVCs failed", "error", err)
		return
	}
	deleted := 0
	for _, pvc := range pvcs.Items {
		agentName := pvc.Labels[LabelAgent]
		if agentName == "" {
			continue
		}
		_, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, agentName, metav1.GetOptions{})
		if err == nil {
			continue
		}
		if !errors.IsNotFound(err) {
			slog.Warn("orphan PVC GC: API lookup failed", "agent", agentName, "error", err)
			continue
		}
		if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil {
			slog.Warn("orphan PVC GC: delete failed", "pvc", pvc.Name, "agent", agentName, "error", err)
			continue
		}
		slog.Info("orphan PVC GC: deleted PVC for missing agent", "pvc", pvc.Name, "agent", agentName)
		deleted++
	}
	if deleted > 0 {
		slog.Info("orphan PVC GC: sweep complete", "deleted", deleted, "scanned", len(pvcs.Items))
	}
}

// ReconcileOrphanLeafSecrets deletes any per-agent envoy leaf TLS
// Secret whose agent ConfigMap no longer exists. Covers historical
// leaks from before owner-references were added to these Secrets, plus
// any future Secret that slips through (e.g. cert-manager produced the
// Secret between the controller patching the ownerRef and the agent
// being deleted, or the controller crashed in that window).
//
// Match is intentionally tight: Secret name ends in `-envoy-tls`, type
// is `kubernetes.io/tls`, and the prefix names a non-existent
// ConfigMap. Anything else is left alone.
func (r *AgentReconciler) ReconcileOrphanLeafSecrets(ctx context.Context) {
	secrets, err := r.client.CoreV1().Secrets(r.config.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("orphan leaf Secret GC: listing Secrets failed", "error", err)
		return
	}
	deleted := 0
	scanned := 0
	for _, sec := range secrets.Items {
		agentName, ok := agentNameFromLeafSecret(sec)
		if !ok {
			continue
		}
		scanned++
		_, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, agentName, metav1.GetOptions{})
		if err == nil {
			continue
		}
		if !errors.IsNotFound(err) {
			slog.Warn("orphan leaf Secret GC: API lookup failed", "agent", agentName, "error", err)
			continue
		}
		if err := r.client.CoreV1().Secrets(r.config.Namespace).Delete(ctx, sec.Name, metav1.DeleteOptions{}); err != nil {
			slog.Warn("orphan leaf Secret GC: delete failed", "secret", sec.Name, "agent", agentName, "error", err)
			continue
		}
		slog.Info("orphan leaf Secret GC: deleted Secret for missing agent", "secret", sec.Name, "agent", agentName)
		deleted++
	}
	if deleted > 0 {
		slog.Info("orphan leaf Secret GC: sweep complete", "deleted", deleted, "scanned", scanned)
	}
}

// agentNameFromLeafSecret returns (agent, true) if the Secret is
// shaped like a per-agent envoy leaf TLS Secret produced by
// cert-manager from BuildEnvoyLeafCertificate, else ("", false).
func agentNameFromLeafSecret(sec corev1.Secret) (string, bool) {
	if sec.Type != corev1.SecretTypeTLS {
		return "", false
	}
	const suffix = envoyLeafSecretSuffix
	if len(sec.Name) <= len(suffix) {
		return "", false
	}
	if sec.Name[len(sec.Name)-len(suffix):] != suffix {
		return "", false
	}
	return sec.Name[:len(sec.Name)-len(suffix)], true
}

func (r *AgentReconciler) setError(ctx context.Context, name, msg string) error {
	WriteAgentStatus(ctx, r.client, r.config.Namespace, name, types.NewAgentStatus("error", msg))
	return fmt.Errorf("agent %s: %s", name, msg)
}

func (r *AgentReconciler) applyStatefulSet(ctx context.Context, desired *appsv1.StatefulSet) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.AppsV1().StatefulSets(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.AppsV1().StatefulSets(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		existing.Spec.Replicas = desired.Spec.Replicas
		existing.Spec.Template = desired.Spec.Template
		// UpdateStrategy is also patched so changes to RollingUpdate
		// semantics (e.g. setting maxUnavailable: 1 to unstick rollouts
		// past CrashLoop pods on the gateway StatefulSet) reach already-
		// installed StatefulSets — without this, the strategy diff is
		// silently dropped on every Update call.
		existing.Spec.UpdateStrategy = desired.Spec.UpdateStrategy
		_, err = r.client.AppsV1().StatefulSets(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

// forceRollStuckPod evicts any pod owned by the named StatefulSet that's
// stuck on the old revision while the StatefulSet has a newer
// updateRevision pending. Only acts when the existing pod is NotReady — a
// healthy old-revision pod is left alone so normal rolling-update
// semantics still apply on clusters where the MaxUnavailableStatefulSet
// feature gate is enabled.
//
// Best-effort: returns the first error encountered but does not roll
// back. The caller logs the error; the next reconcile will retry.
func (r *AgentReconciler) forceRollStuckPod(ctx context.Context, namespace, statefulSetName string) error {
	ss, err := r.client.AppsV1().StatefulSets(namespace).Get(ctx, statefulSetName, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("getting statefulset: %w", err)
	}
	if ss.Status.UpdateRevision == "" || ss.Status.UpdateRevision == ss.Status.CurrentRevision {
		return nil
	}
	// Selector restricts to pods this SS actually manages; combined with
	// the controller-revision-hash label that pins to the OLD revision,
	// we never touch a pod that's already on the new spec.
	sel, err := metav1.LabelSelectorAsSelector(ss.Spec.Selector)
	if err != nil {
		return fmt.Errorf("building selector: %w", err)
	}
	pods, err := r.client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
	if err != nil {
		return fmt.Errorf("listing pods: %w", err)
	}
	for _, p := range pods.Items {
		if p.Labels["controller-revision-hash"] != ss.Status.CurrentRevision {
			continue
		}
		if isPodReady(p) {
			continue
		}
		if p.DeletionTimestamp != nil {
			// Already being deleted by something else; let it complete.
			continue
		}
		slog.Info("force-rolling stuck StatefulSet pod past CrashLoop deadlock",
			"namespace", namespace, "statefulset", statefulSetName, "pod", p.Name,
			"oldRev", ss.Status.CurrentRevision, "newRev", ss.Status.UpdateRevision)
		if err := r.client.CoreV1().Pods(namespace).Delete(ctx, p.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("deleting stuck pod %s: %w", p.Name, err)
		}
	}
	return nil
}

func (r *AgentReconciler) applyService(ctx context.Context, desired *corev1.Service) error {
	_, err := r.client.CoreV1().Services(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = r.client.CoreV1().Services(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	return err
}

var certificateGVR = schema.GroupVersionResource{
	Group:    cmv1.SchemeGroupVersion.Group,
	Version:  cmv1.SchemeGroupVersion.Version,
	Resource: "certificates",
}

// applyCertificate creates or updates a cert-manager.io/v1 Certificate via the
// dynamic client. We don't pull in the full cert-manager typed client just to
// PUT one resource shape — converting to/from unstructured is cheap and keeps
// the dependency surface to the (already) imported types package.
func (r *AgentReconciler) applyCertificate(ctx context.Context, desired *cmv1.Certificate) error {
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
		// Preserve resourceVersion + status; replace spec/labels/owner.
		desiredU.SetResourceVersion(existing.GetResourceVersion())
		_, err = cli.Update(ctx, desiredU, metav1.UpdateOptions{})
		return err
	})
}

func (r *AgentReconciler) applyConfigMap(ctx context.Context, desired *corev1.ConfigMap) error {
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
