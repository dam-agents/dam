package reconciler

import (
	"context"
	"fmt"
	"sync"
	"time"

	cmv1 "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"
	"log/slog"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

type AgentReconciler struct {
	client  kubernetes.Interface
	dynamic dynamic.Interface
	config  *config.Config

	budgetMu    sync.Mutex
	ownerLocks  map[string]*sync.Mutex
	deniedWakes map[string]string
	parkedRetry map[string]struct{}
	busyProbe   func(ctx context.Context, agentName string) bool
}

func NewAgentReconciler(client kubernetes.Interface, cfg *config.Config) *AgentReconciler {
	r := &AgentReconciler{client: client, config: cfg}
	r.busyProbe = func(ctx context.Context, name string) bool {
		return agentPodIsBusy(ctx, r.config.Namespace, name)
	}
	return r
}

func (r *AgentReconciler) WithDynamicClient(d dynamic.Interface) *AgentReconciler {
	r.dynamic = d
	return r
}

func (r *AgentReconciler) Reconcile(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	ownerRef := agentOwnerRef(agent)
	agentSpec := &agent.Spec

	timer := newReconcileTimer(ctx, "agent", name)
	defer timer.done()

	owner := agent.Labels["agent-platform.ai/owner"]

	if err := r.ensureConcreteSize(ctx, agent); err != nil {
		return fmt.Errorf("agent %s: %w", name, err)
	}

	credentialSecrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, owner,
		agentSpec.GrantedSecretIDs, agentSpec.GrantedConnectionIDs)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("listing credential secrets: %v", err))
	}
	timer.mark("credentials")

	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(name, agentSpec.TelemetryAttributionID, r.config, ownerRef, credentialSecrets, agentSpec.L7Hosts)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("rendering envoy bootstrap: %v", err))
	}
	if err := r.applyConfigMap(ctx, bootstrapCM); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying envoy bootstrap: %v", err))
	}
	timer.mark("envoyBootstrap")
	if cert := BuildEnvoyLeafCertificate(name, r.config, ownerRef, credentialSecrets, agentSpec.L7Hosts); cert != nil {
		if err := r.applyCertificate(ctx, cert); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("applying envoy leaf certificate: %v", err))
		}
		if err := r.ensureLeafSecretOwnerReference(ctx, name, ownerRef); err != nil {
			slog.Warn("setting owner ref on envoy leaf TLS Secret; will retry on next reconcile",
				"agent", name, "error", err)
		}
	}
	timer.mark("leafCert")

	if err := r.ensureServiceAccount(ctx, name, ownerRef); err != nil {
		return r.setError(ctx, name, err.Error())
	}
	timer.mark("serviceAccount")

	extAuthzSvc := BuildExtAuthzService(name, r.config)
	if err := r.applyExtAuthzService(ctx, extAuthzSvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz service: %v", err))
	}
	timer.mark("extAuthzService")

	if err := r.applyAuthorizationPolicy(ctx, BuildHarnessAuthorizationPolicy(name, r.config, agent.Namespace, ownerRef)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying harness authz policy: %v", err))
	}
	if err := r.applyAuthorizationPolicy(ctx, BuildExtAuthzAuthorizationPolicy(name, r.config, agent.Namespace, ownerRef)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz authz policy: %v", err))
	}
	timer.mark("authzPolicies")

	if err := applyNetworkPolicy(ctx, r.client, BuildAgentEgressNetworkPolicy(name, r.config, ownerRef)); err != nil {
		return r.setError(ctx, name, err.Error())
	}
	timer.mark("egressNetworkPolicy")

	idleTimeout := effectiveIdleTimeout(agent.Spec.HibernationTimeout, r.config.AgentBase.IdleTimeout.AsDuration())
	running := shouldRun(agent.Annotations, idleTimeout, time.Now().UTC())

	lastActivity := agent.Annotations[annLastActivity]
	alwaysOn := idleTimeout <= 0
	autoRetry := alwaysOn || agent.Annotations[annSweepable] == "true"
	overBudget := ""
	parked := false
	if running {
		if !autoRetry && r.wakeAlreadyDenied(name, lastActivity) {
			running = false
			parked = true
		} else {
			verdict, err := r.budgetAllows(ctx, agent, owner)
			if err != nil {
				return fmt.Errorf("agent %s: budget check: %w", name, err)
			}
			if !verdict.allowed {
				freed, err := r.reclaimIdleRoom(ctx, agent, owner)
				if err != nil {
					return fmt.Errorf("agent %s: reclaiming idle room: %w", name, err)
				}
				if freed {
					if verdict, err = r.budgetAllows(ctx, agent, owner); err != nil {
						return fmt.Errorf("agent %s: budget re-check: %w", name, err)
					}
				}
			}
			if !verdict.allowed {
				running = false
				parked = true
				overBudget = verdict.message
				if !autoRetry {
					r.recordDeniedWake(name, lastActivity)
				}
			} else {
				r.clearDeniedWake(name)
			}
		}
	}

	if running {
		verdict, grew, err := r.resizeAllows(ctx, agent, owner)
		if err != nil {
			return fmt.Errorf("agent %s: resize budget check: %w", name, err)
		}
		if grew && !verdict.allowed {
			running = false
			parked = true
			overBudget = verdict.message
			if !autoRetry {
				r.recordDeniedWake(name, lastActivity)
			}
			if err := scaleAgentPairToZero(ctx, r.client, r.dynamic, r.config.Namespace, name, agentSpec.IsVM()); err != nil {
				return r.setError(ctx, name, fmt.Sprintf("parking resized-over-budget pair: %v", err))
			}
		}
	}

	if parked && autoRetry {
		r.recordParkedRetry(name)
	} else {
		r.clearParkedRetry(name)
	}

	rollRev := agent.Annotations[annRollRev]

	gatewaySS := BuildGatewayStatefulSet(name, !running, r.config, ownerRef, credentialSecrets, agentSpec.L7Hosts)
	stampRollRev(gatewaySS, rollRev)
	gatewaySvc := BuildGatewayService(name, r.config, ownerRef)

	if err := r.applyStatefulSet(ctx, gatewaySS, running); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying gateway statefulset: %v", err))
	}
	if err := r.forceRollStuckPod(ctx, gatewaySS.Namespace, gatewaySS.Name); err != nil {
		slog.Warn("force-rolling stuck gateway pod failed; rollout may be deadlocked",
			"namespace", gatewaySS.Namespace, "statefulset", gatewaySS.Name, "error", err)
	}
	timer.mark("gatewayStatefulSet")
	liveGatewaySvc, err := ensureGatewayService(ctx, r.client, gatewaySvc, "agent", name)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("ensuring gateway service: %v", err))
	}
	gatewayIP := liveGatewaySvc.Spec.ClusterIP
	timer.mark("gatewayService")

	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("agent %s: gateway Service ClusterIP not yet assigned, requeuing", name)
	}

	if agentSpec.IsVM() {
		if !r.config.VM.Enabled {
			return r.setError(ctx, name, "vm backend requested but virtualization is disabled in this install (virtualization.enabled)")
		}
		if err := r.reconcileAgentVM(ctx, agent, ownerRef, gatewayIP, running); err != nil {
			return fmt.Errorf("agent %s: vm: %w", name, err)
		}
		timer.mark("agentVirtualMachine")
	} else {
		claims, err := r.resolveWorkspaceClaims(ctx, agent, agentSpec)
		if err != nil {
			return r.setError(ctx, name, fmt.Sprintf("resolving warm-pool claims: %v", err))
		}
		timer.mark("workspaceClaims")
		agentSS := BuildAgentStatefulSet(name, agentSpec, r.config, ownerRef, gatewayIP)
		applyPoolClaims(agentSS, claims)
		stampRollRev(agentSS, rollRev)
		if err := r.applyStatefulSet(ctx, agentSS, running); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("applying agent statefulset: %v", err))
		}
	}
	if err := r.applyService(ctx, BuildAgentService(name, r.config, ownerRef)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying agent service: %v", err))
	}
	timer.mark("agentStatefulSet")

	if agent.Annotations[annStopRequested] != "" || agent.Annotations[annStorageMigration] != "" {
		if err := hibernateAgentPair(ctx, r.client, r.dynamic, r.config.Namespace, name, agentSpec.IsVM()); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("stopping agent: %v", err))
		}
		err = r.publishReconciled(ctx, agent)
		timer.mark("hardStop")
		return err
	}

	if running {
		err = r.publishReadiness(ctx, agent)
		timer.mark("readiness")
		return err
	}
	if parked {
		if err := scaleAgentPairToZero(ctx, r.client, r.dynamic, r.config.Namespace, name, agentSpec.IsVM()); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("scaling down parked agent pair: %v", err))
		}
	}
	if overBudget != "" {
		err = r.publishOverBudget(ctx, agent, overBudget)
		timer.mark("overBudget")
		return err
	}
	err = r.publishReconciled(ctx, agent)
	timer.mark("reconciled")
	return err
}

func (r *AgentReconciler) publishReadiness(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	gen := agent.Generation
	agentReady := false
	if agent.Spec.IsVM() {
		agentReady = r.vmCurrentAndReady(ctx, name)
	} else {
		agentReady = r.podCurrentAndReady(ctx, name)
	}
	gatewayReady := r.podCurrentAndReady(ctx, GatewayName(name))
	ready := agentReady && gatewayReady

	var agentPod *corev1.Pod
	if !agent.Spec.IsVM() {
		agentPod = r.getPod(ctx, name)
	}

	agentFailReason, agentFailMsg := "PodNotReady", ""
	if !agentReady {
		if reason, msg, ok := terminationReason(agentPod); ok {
			agentFailReason, agentFailMsg = reason, msg
		}
	}

	agentRestarts, agentRestartReason := podRestarts(agentPod)

	gatewayFailReason, gatewayFailMsg := "PodNotReady", ""
	if !gatewayReady {
		gatewayFailReason, gatewayFailMsg = r.gatewayNotReadyCause(ctx, GatewayName(name))
	}

	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, agentReady, "PodReady", agentFailReason, agentFailMsg, gen)
		setStatusCondition(s, apiv1.ConditionGatewayPodReady, gatewayReady, "PodReady", gatewayFailReason, gatewayFailMsg, gen)
		setStatusCondition(s, apiv1.ConditionReady, ready, "AllPodsReady", "PodsNotReady", "", gen)
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.AgentPodRestarts = agentRestarts
		s.AgentPodRestartReason = agentRestartReason
		s.ObservedGeneration = gen
	})
}

func (r *AgentReconciler) publishReconciled(ctx context.Context, agent *apiv1.Agent) error {
	gen := agent.Generation
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.ObservedGeneration = gen
	})
}

func podStuckOnSupersededRevision(ss *appsv1.StatefulSet, p *corev1.Pod) bool {
	if ss.Status.UpdateRevision == "" || ss.Status.ObservedGeneration != ss.Generation {
		return false
	}
	if p.Labels["controller-revision-hash"] == ss.Status.UpdateRevision {
		return false
	}
	return !isPodReady(*p)
}

func (r *AgentReconciler) gatewayNotReadyCause(ctx context.Context, ssName string) (reason, message string) {
	pod := r.getPod(ctx, ssName)
	if pod == nil {
		return "PodNotReady", ""
	}
	if reason, msg, ok := terminationReason(pod); ok {
		return reason, msg
	}
	ss, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, ssName, metav1.GetOptions{})
	if err != nil || !podStuckOnSupersededRevision(ss, pod) {
		return "PodNotReady", ""
	}
	return apiv1.ReasonStuckOnSupersededRevision, fmt.Sprintf(
		"gateway pod is on superseded revision %s (target %s) and cannot become ready; replacing it",
		pod.Labels["controller-revision-hash"], ss.Status.UpdateRevision)
}

func (r *AgentReconciler) podCurrentAndReady(ctx context.Context, ssName string) bool {
	ss, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, ssName, metav1.GetOptions{})
	if err != nil {
		return false
	}
	if ss.Status.ObservedGeneration != ss.Generation {
		return false
	}
	pod := r.getPod(ctx, ssName)
	if pod == nil {
		return false
	}
	return isPodReady(*pod) &&
		pod.Labels["controller-revision-hash"] == ss.Status.UpdateRevision
}

func (r *AgentReconciler) getPod(ctx context.Context, ssName string) *corev1.Pod {
	pod, err := r.client.CoreV1().Pods(r.config.Namespace).Get(ctx, ssName+"-0", metav1.GetOptions{})
	if err != nil {
		return nil
	}
	return pod
}

func (r *AgentReconciler) ensureLeafSecretOwnerReference(ctx context.Context, agentName string, ownerRef metav1.OwnerReference) error {
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
			if ref.UID == ownerRef.UID {
				return nil
			}
		}
		sec.OwnerReferences = append(sec.OwnerReferences, metav1.OwnerReference{
			APIVersion: ownerRef.APIVersion,
			Kind:       ownerRef.Kind,
			Name:       ownerRef.Name,
			UID:        ownerRef.UID,
		})
		_, err = r.client.CoreV1().Secrets(r.config.Namespace).Update(ctx, sec, metav1.UpdateOptions{})
		return err
	})
}

func (r *AgentReconciler) Delete(ctx context.Context, name string) {
	// + ext-authz AuthorizationPolicies) cannot use a cross-namespace
	r.deleteReleaseNsAgentResources(ctx, name)

	r.deletePVCs(ctx, name)

	r.clearDeniedWake(name)
	r.clearParkedRetry(name)
}

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

func (r *AgentReconciler) resolveWorkspaceClaims(ctx context.Context, agent *apiv1.Agent, agentSpec *apiv1.AgentSpec) (map[string]string, error) {
	name := agent.Name
	defaults := r.config.AgentTemplateDefaults

	persisted := map[string]bool{}
	for _, mnt := range resolveSpecMounts(agentSpec, defaults) {
		if mnt.Persist {
			persisted[types.SanitizeMountName(mnt.Path)] = true
		}
	}

	sts, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		claims := map[string]string{}
		for _, v := range sts.Spec.Template.Spec.Volumes {
			if v.PersistentVolumeClaim != nil && persisted[v.Name] {
				claims[v.Name] = v.PersistentVolumeClaim.ClaimName
			}
		}
		return claims, nil
	}
	if !errors.IsNotFound(err) {
		return nil, err
	}

	claimed, err := r.listClaimedPoolPVCs(ctx, name)
	if err != nil {
		return nil, err
	}
	claims := map[string]string{}
	for mount, pvc := range claimed {
		if persisted[mount] {
			claims[mount] = pvc
		}
	}
	if !r.config.WarmPool.Enabled {
		return claims, nil
	}

	targets := poolTargets(r.config.WarmPool)
	for _, mnt := range resolveSpecMounts(agentSpec, defaults) {
		if !mnt.Persist {
			continue
		}
		volName := types.SanitizeMountName(mnt.Path)
		if _, ok := claims[volName]; ok {
			continue
		}
		key, ok := matchPoolKey(targets, effectiveMountSize(mnt, agentSpec, defaults))
		if !ok {
			continue
		}
		pvcName, err := r.claimSpare(ctx, name, key, volName)
		if err != nil {
			return nil, err
		}
		if pvcName != "" {
			claims[volName] = pvcName
		}
	}
	return claims, nil
}

func (r *AgentReconciler) listClaimedPoolPVCs(ctx context.Context, agentName string) (map[string]string, error) {
	list, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + agentName,
	})
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, p := range list.Items {
		if _, fromPool := p.Labels[LabelPool]; !fromPool {
			continue
		}
		if mount := p.Labels[LabelMount]; mount != "" {
			out[mount] = p.Name
		}
	}
	return out, nil
}

func (r *AgentReconciler) claimSpare(ctx context.Context, agentName, poolKey, mountName string) (string, error) {
	list, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelPool + "=" + poolKey + "," + LabelPoolAvailable + "=true",
	})
	if err != nil {
		return "", err
	}
	for i := range list.Items {
		p := &list.Items[i]
		if p.Status.Phase != corev1.ClaimBound {
			continue
		}
		if p.Labels == nil {
			p.Labels = map[string]string{}
		}
		p.Labels[LabelAgent] = agentName
		p.Labels[LabelMount] = mountName
		delete(p.Labels, LabelPoolAvailable)
		if _, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Update(ctx, p, metav1.UpdateOptions{}); err != nil {
			if errors.IsConflict(err) || errors.IsNotFound(err) {
				continue
			}
			return "", err
		}
		slog.Info("warm pool: claimed spare for agent", "agent", agentName, "pool", poolKey, "mount", mountName, "pvc", p.Name)
		return p.Name, nil
	}
	return "", nil
}

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
		_, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, agentName, metav1.GetOptions{})
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
		_, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).Get(ctx, agentName, metav1.GetOptions{})
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
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		if c := apimeta.FindStatusCondition(s.Conditions, apiv1.ConditionReconciled); c != nil && c.Reason == "BackoffLimitExceeded" {
			return
		}
		setStatusCondition(s, apiv1.ConditionReconciled, false, "Reconciled", "ReconcileError", msg, 0)
	}); err != nil {
		slog.Warn("writing agent reconcile-error status", "agent", name, "error", err)
	}
	return fmt.Errorf("agent %s: %s", name, msg)
}

func (r *AgentReconciler) SetBackoffExceeded(ctx context.Context, name string, attempts int, cause error) {
	msg := fmt.Sprintf("reconcile failed %d times, retrying with capped backoff: %v", attempts, cause)
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, false, "Reconciled", "BackoffLimitExceeded", msg, 0)
	}); err != nil {
		slog.Warn("writing agent backoff-exceeded status", "agent", name, "error", err)
	}
}

func stampRollRev(ss *appsv1.StatefulSet, rollRev string) {
	if rollRev == "" {
		return
	}
	if ss.Spec.Template.Annotations == nil {
		ss.Spec.Template.Annotations = map[string]string{}
	}
	ss.Spec.Template.Annotations[annRollRev] = rollRev
}

func (r *AgentReconciler) applyStatefulSet(ctx context.Context, desired *appsv1.StatefulSet, running bool) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.AppsV1().StatefulSets(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			replicas := int32(0)
			if running {
				replicas = 1
			}
			desired.Spec.Replicas = &replicas
			_, err = r.client.AppsV1().StatefulSets(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		if running {
			one := int32(1)
			existing.Spec.Replicas = &one
		}
		existing.Spec.Template = desired.Spec.Template
		existing.Spec.UpdateStrategy = desired.Spec.UpdateStrategy
		_, err = r.client.AppsV1().StatefulSets(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

func (r *AgentReconciler) forceRollStuckPod(ctx context.Context, namespace, statefulSetName string) error {
	ss, err := r.client.AppsV1().StatefulSets(namespace).Get(ctx, statefulSetName, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("getting statefulset: %w", err)
	}
	if ss.Status.UpdateRevision == "" || ss.Status.ObservedGeneration != ss.Generation {
		return nil
	}
	sel, err := metav1.LabelSelectorAsSelector(ss.Spec.Selector)
	if err != nil {
		return fmt.Errorf("building selector: %w", err)
	}
	pods, err := r.client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
	if err != nil {
		return fmt.Errorf("listing pods: %w", err)
	}
	for _, p := range pods.Items {
		if !podStuckOnSupersededRevision(ss, &p) {
			continue
		}
		if p.DeletionTimestamp != nil {
			continue
		}
		slog.Info("force-rolling StatefulSet pod stuck on a superseded revision",
			"namespace", namespace, "statefulset", statefulSetName, "pod", p.Name,
			"podRev", p.Labels["controller-revision-hash"],
			"currentRev", ss.Status.CurrentRevision, "targetRev", ss.Status.UpdateRevision)
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
