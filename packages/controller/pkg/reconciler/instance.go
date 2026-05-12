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

type InstanceReconciler struct {
	client   kubernetes.Interface
	dynamic  dynamic.Interface // required to apply cert-manager Certificates
	config   *config.Config
	resolver *AgentResolver
}

func NewInstanceReconciler(client kubernetes.Interface, cfg *config.Config, resolver *AgentResolver) *InstanceReconciler {
	return &InstanceReconciler{client: client, config: cfg, resolver: resolver}
}

// WithDynamicClient supplies a dynamic client used to apply cert-manager.io/v1
// Certificate resources for the per-instance Envoy leaf TLS Secret.
func (r *InstanceReconciler) WithDynamicClient(d dynamic.Interface) *InstanceReconciler {
	r.dynamic = d
	return r
}

func (r *InstanceReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	name := cm.Name

	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return r.setError(ctx, name, "no spec.yaml in ConfigMap")
	}
	instanceSpec, err := types.ParseInstanceSpec(specYAML)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// Resolve agent — prefer label, fall back to spec field
	agentName := cm.Labels["agent-platform.ai/agent"]
	if agentName == "" {
		agentName = instanceSpec.AgentName
	}
	agentCM, agentSpec, err := r.resolver.Resolve(agentName)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// Ensure the instance CM has an OwnerReference to its agent CM so that
	// K8s garbage collection cascade-deletes orphaned instances when the
	// agent is removed. Idempotent — skips if already set.
	if err := r.ensureAgentOwnerReference(ctx, cm, agentCM); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("setting agent owner reference: %v", err))
	}

	owner := agentCM.Labels["agent-platform.ai/owner"]
	credentialSecrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, owner, cm)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("listing credential secrets: %v", err))
	}

	if !hasGitHubCredential(credentialSecrets) {
		slog.Warn("no GitHub credential Secret attached — gh/octokit calls will be unauthenticated",
			"instance", name, "owner", owner)
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
	}

	// ADR-041: per-instance SA must exist before the agent + gateway pods
	// start (kubelet rejects pod scheduling on a missing SA, and Istio
	// stamps the SPIFFE workload cert from it).
	if err := r.ensureServiceAccount(ctx, name, cm); err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// ADR-041: per-instance ext-authz Service in the release namespace —
	// the gateway pod's Envoy bootstrap dials this Service for HITL
	// approvals, and the per-instance AuthorizationPolicy below pins it
	// to the matching SA principal.
	extAuthzSvc := BuildExtAuthzService(name, r.config, cm)
	if err := r.applyExtAuthzService(ctx, extAuthzSvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz service: %v", err))
	}

	// ADR-041: three per-instance AuthorizationPolicies — gateway admission
	// (agent ns), harness path-prefix at the waypoint (release ns),
	// ext-authz Service principal (release ns).
	if err := r.applyAuthorizationPolicy(ctx, BuildGatewayAuthorizationPolicy(name, name, r.config, cm)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying gateway authz policy: %v", err))
	}
	if err := r.applyAuthorizationPolicy(ctx, BuildHarnessAuthorizationPolicy(name, r.config, cm)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying harness authz policy: %v", err))
	}
	if err := r.applyAuthorizationPolicy(ctx, BuildExtAuthzAuthorizationPolicy(name, r.config, cm)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz authz policy: %v", err))
	}

	// ADR-041: per-pair agent egress NetworkPolicy. AuthorizationPolicy on
	// the gateway only gates ingress; without an egress NP the agent
	// process can bypass HTTPS_PROXY and dial external hosts directly,
	// escaping Envoy's credential and HITL gates.
	if err := r.applyAgentEgressNetworkPolicy(ctx, BuildAgentEgressNetworkPolicy(name, r.config, cm)); err != nil {
		return r.setError(ctx, name, err.Error())
	}

	hibernated := instanceSpec.DesiredState == "hibernated"

	// ADR-038: paired pods, rendered as a unit. Render the gateway first
	// so the agent's HTTPS_PROXY target exists by the time the agent pod
	// starts dialing it. ADR-041: pair-key NetworkPolicies are gone —
	// pair isolation is now enforced by the per-instance AuthorizationPolicy
	// on the gateway Service (mesh-level, cryptographic).
	gatewaySS := BuildGatewayStatefulSet(name, hibernated, r.config, cm, credentialSecrets)
	gatewaySvc := BuildGatewayService(name, r.config, cm)

	agentSS := BuildAgentStatefulSet(name, instanceSpec, agentSpec, r.config, cm, credentialSecrets)
	agentSvc := BuildAgentService(name, r.config, cm)

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
	if err := r.applyService(ctx, gatewaySvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying gateway service: %v", err))
	}
	if err := r.applyStatefulSet(ctx, agentSS); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying agent statefulset: %v", err))
	}
	if err := r.applyService(ctx, agentSvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying agent service: %v", err))
	}

	state := instanceSpec.DesiredState
	if state == "" {
		state = "running"
	}
	return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus(state, ""))
}

// ensureAgentOwnerReference adds a non-controller OwnerReference from the
// instance CM to the agent CM if one is not already present. This lets K8s
// garbage collection cascade-delete instances when their agent is removed.
// It is safe to leave BlockOwnerDeletion=false and Controller=false — other
// OwnerReferences on the instance CM (if any) are preserved.
func (r *InstanceReconciler) ensureAgentOwnerReference(ctx context.Context, instanceCM, agentCM *corev1.ConfigMap) error {
	for _, ref := range instanceCM.OwnerReferences {
		if ref.UID == agentCM.UID {
			return nil
		}
	}
	desired := metav1.OwnerReference{
		APIVersion: "v1",
		Kind:       "ConfigMap",
		Name:       agentCM.Name,
		UID:        agentCM.UID,
	}
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		current, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, instanceCM.Name, metav1.GetOptions{})
		if err != nil {
			return err
		}
		for _, ref := range current.OwnerReferences {
			if ref.UID == agentCM.UID {
				return nil
			}
		}
		current.OwnerReferences = append(current.OwnerReferences, desired)
		_, err = r.client.CoreV1().ConfigMaps(r.config.Namespace).Update(ctx, current, metav1.UpdateOptions{})
		return err
	})
}

func (r *InstanceReconciler) Delete(ctx context.Context, name string) {
	// Owner references in the agent namespace cascade-delete agent +
	// gateway StatefulSets, the agent + gateway Services, the per-instance
	// ServiceAccount, the gateway-admission AuthorizationPolicy, the
	// Envoy bootstrap ConfigMap, and the cert-manager Certificate / leaf
	// Secret.
	//
	// ADR-041 release-namespace resources (per-instance ext-authz
	// Service, harness + ext-authz AuthorizationPolicies) cannot use a
	// cross-namespace ownerRef — K8s assumes same-namespace ownerRefs and
	// the GC controller reaps them as orphans. Clean up explicitly.
	r.deleteReleaseNsInstanceResources(ctx, name)

	// PVCs created via VolumeClaimTemplates on the agent StatefulSet are
	// intentionally NOT cascade-deleted by K8s (to prevent data loss).
	// We clean them up explicitly here.
	r.deletePVCs(ctx, name)
}

// deleteReleaseNsInstanceResources deletes the release-namespace resources
// the controller renders for this instance: the per-instance ext-authz
// Service and the two AuthorizationPolicies (harness + ext-authz). Errors
// are logged but not returned — instance deletion best-effort proceeds.
func (r *InstanceReconciler) deleteReleaseNsInstanceResources(ctx context.Context, instanceName string) {
	svcName := r.config.ExtAuthzServiceName(instanceName)
	if err := r.client.CoreV1().Services(r.config.ReleaseNamespace).Delete(ctx, svcName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		slog.Warn("deleting per-instance ext-authz Service", "service", svcName, "instance", instanceName, "error", err)
	}
	if r.dynamic == nil {
		return
	}
	for _, name := range []string{instanceName + "-harness-allow", instanceName + "-extauthz-allow"} {
		if err := r.dynamic.Resource(authzPolicyGVR).Namespace(r.config.ReleaseNamespace).
			Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			slog.Warn("deleting per-instance AuthorizationPolicy", "policy", name, "instance", instanceName, "error", err)
		}
	}
}

func (r *InstanceReconciler) deletePVCs(ctx context.Context, instanceName string) {
	pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
		metav1.ListOptions{LabelSelector: "agent-platform.ai/instance=" + instanceName},
	)
	if err != nil {
		slog.Warn("listing PVCs for instance", "instance", instanceName, "error", err)
		return
	}
	for _, pvc := range pvcs.Items {
		if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil {
			slog.Warn("deleting PVC", "pvc", pvc.Name, "instance", instanceName, "error", err)
		}
	}
}

// ReconcileOrphanPVCs deletes any PVC labeled `agent-platform.ai/instance=<name>` whose
// instance ConfigMap no longer exists. Covers two leak modes (issue #244):
// the controller crashing between StatefulSet teardown and PVC deletion, and
// users removing the instance ConfigMap out-of-band (e.g. via kubectl).
//
// Safe against the create-PVC-before-finalize race because we re-read the
// ConfigMap from the API server (not the informer cache) before deleting.
func (r *InstanceReconciler) ReconcileOrphanPVCs(ctx context.Context) {
	pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
		metav1.ListOptions{LabelSelector: "agent-platform.ai/instance"},
	)
	if err != nil {
		slog.Warn("orphan PVC GC: listing PVCs failed", "error", err)
		return
	}
	deleted := 0
	for _, pvc := range pvcs.Items {
		instanceName := pvc.Labels["agent-platform.ai/instance"]
		if instanceName == "" {
			continue
		}
		_, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, instanceName, metav1.GetOptions{})
		if err == nil {
			continue
		}
		if !errors.IsNotFound(err) {
			slog.Warn("orphan PVC GC: API lookup failed", "instance", instanceName, "error", err)
			continue
		}
		if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil {
			slog.Warn("orphan PVC GC: delete failed", "pvc", pvc.Name, "instance", instanceName, "error", err)
			continue
		}
		slog.Info("orphan PVC GC: deleted PVC for missing instance", "pvc", pvc.Name, "instance", instanceName)
		deleted++
	}
	if deleted > 0 {
		slog.Info("orphan PVC GC: sweep complete", "deleted", deleted, "scanned", len(pvcs.Items))
	}
}

func (r *InstanceReconciler) setError(ctx context.Context, name, msg string) error {
	WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("error", msg))
	return fmt.Errorf("instance %s: %s", name, msg)
}

func (r *InstanceReconciler) applyStatefulSet(ctx context.Context, desired *appsv1.StatefulSet) error {
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
func (r *InstanceReconciler) forceRollStuckPod(ctx context.Context, namespace, statefulSetName string) error {
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

func (r *InstanceReconciler) applyService(ctx context.Context, desired *corev1.Service) error {
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
func (r *InstanceReconciler) applyCertificate(ctx context.Context, desired *cmv1.Certificate) error {
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

func (r *InstanceReconciler) applyConfigMap(ctx context.Context, desired *corev1.ConfigMap) error {
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
