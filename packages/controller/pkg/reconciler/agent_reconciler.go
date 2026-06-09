package reconciler

import (
	"context"
	"fmt"
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

// AgentReconciler renders an Agent custom resource (ADR-058) into its agent +
// gateway StatefulSets, Services, per-agent SA / ext-authz / AuthorizationPolicies
// and egress NetworkPolicy, and publishes observed state on the status subresource.
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

// Reconcile renders the Agent's resources and publishes its status conditions
// (ADR-058/059). The controller is the sole status writer; the api-server routes
// on Ready and surfaces the Reconciled message as the agent's error. Reconciled
// ("last render accepted") and readiness ("pods running") are orthogonal —
// Ready=True with Reconciled=False is valid (running pods stay routable while a
// later re-render fails).
//
//	Trigger                          Reconciled                    Readiness                 Next reconcile
//	-------------------------------  ----------------------------  ------------------------  --------------
//	render step fails                False / ReconcileError        unchanged                 rate-limited backoff
//	gateway ClusterIP not assigned   unchanged (transient wait)    unchanged                 rate-limited backoff
//	failures >= maxReconcileRetries  False / BackoffLimitExceeded  unchanged                 capped backoff + resync
//	render ok, running               True / Reconciled             observed pod readiness*   pod events + resync
//	render ok, idle (scaled down)    True / Reconciled             unchanged (idle checker)  resync
//	idle checker hibernates          unchanged                     all False / Hibernated    (idle checker loop)
//
//	* Agent/GatewayPodReady = PodReady|PodNotReady; Ready = AllPodsReady|PodsNotReady (both pods required).
//	BackoffLimitExceeded is sticky: setError won't downgrade it (no informer flip-flop); clears on next success.
func (r *AgentReconciler) Reconcile(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	ownerRef := agentOwnerRef(agent)
	agentSpec := &agent.Spec

	timer := newReconcileTimer("agent", name)
	defer timer.done()

	// ADR-058: K8s validated the spec at admission, so the controller trusts
	// the typed resource — no app-layer re-parse or re-validation.
	//
	// The `agent-platform.ai/owner` label scopes credential Secret discovery;
	// grants are read from spec (ADR-058 moved them off annotations).
	owner := agent.Labels["agent-platform.ai/owner"]
	credentialSecrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, owner,
		agentSpec.GrantedSecretIDs, agentSpec.GrantedConnectionIDs)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("listing credential secrets: %v", err))
	}
	timer.mark("credentials")

	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(name, name, r.config, ownerRef, credentialSecrets)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("rendering envoy bootstrap: %v", err))
	}
	if err := r.applyConfigMap(ctx, bootstrapCM); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying envoy bootstrap: %v", err))
	}
	timer.mark("envoyBootstrap")
	// alwaysIssue: agent mounts ca.crt unconditionally, so the leaf must exist.
	if cert := BuildEnvoyLeafCertificate(name, r.config, ownerRef, credentialSecrets, true); cert != nil {
		if err := r.applyCertificate(ctx, cert); err != nil {
			return r.setError(ctx, name, fmt.Sprintf("applying envoy leaf certificate: %v", err))
		}
		// cert-manager's default mode does not set an OwnerReference on the
		// Secret it produces from a Certificate (the global flag
		// --enable-certificate-owner-ref controls that and we don't require
		// it), so deleting the Certificate alone leaves the Secret behind.
		// Patch the produced Secret with an OwnerReference back to the
		// Agent so K8s GC cascade-deletes it with the agent.
		if err := r.ensureLeafSecretOwnerReference(ctx, name, ownerRef); err != nil {
			slog.Warn("setting owner ref on envoy leaf TLS Secret; will retry on next reconcile",
				"agent", name, "error", err)
		}
	}
	timer.mark("leafCert")

	// ADR-041: per-agent SA must exist before the agent + gateway pods
	// start (kubelet rejects pod scheduling on a missing SA, and Istio
	// stamps the SPIFFE workload cert from it).
	if err := r.ensureServiceAccount(ctx, name, ownerRef); err != nil {
		return r.setError(ctx, name, err.Error())
	}
	timer.mark("serviceAccount")

	// ADR-041: per-agent ext-authz Service in the release namespace —
	// the gateway pod's Envoy bootstrap dials this Service for HITL
	// approvals, and the per-agent AuthorizationPolicy below pins it
	// to the matching SA principal.
	extAuthzSvc := BuildExtAuthzService(name, r.config)
	if err := r.applyExtAuthzService(ctx, extAuthzSvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz service: %v", err))
	}
	timer.mark("extAuthzService")

	// Two per-agent AuthorizationPolicies in the release namespace —
	// harness path-prefix at the waypoint, ext-authz Service principal.
	// Both gate the *gateway pod*'s SPIFFE identity (the only pod of the
	// pair that's a mesh participant). The agent → gateway hop is gated
	// by the agent-egress NetworkPolicy below, not by mesh AuthZ.
	if err := r.applyAuthorizationPolicy(ctx, BuildHarnessAuthorizationPolicy(name, r.config, agent.Namespace, ownerRef)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying harness authz policy: %v", err))
	}
	if err := r.applyAuthorizationPolicy(ctx, BuildExtAuthzAuthorizationPolicy(name, r.config, agent.Namespace, ownerRef)); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying ext-authz authz policy: %v", err))
	}
	timer.mark("authzPolicies")

	// Per-pair agent egress NetworkPolicy. Agent pods opt out of ambient
	// mesh, so kernel NP is the only thing gating agent egress; it admits
	// DNS and the paired gateway pod's Envoy port, nothing else. The
	// gateway's Envoy ext_authz filter (ADR-035) gates which destinations
	// the agent's HTTPS_PROXY traffic reaches past the gateway.
	if err := r.applyAgentEgressNetworkPolicy(ctx, BuildAgentEgressNetworkPolicy(name, r.config, ownerRef)); err != nil {
		return r.setError(ctx, name, err.Error())
	}
	timer.mark("egressNetworkPolicy")

	// ADR-058: run state is activity-driven — there is no desiredState. The
	// reconciler scales *up* when recent activity says the agent should run;
	// scale-*down* is the idle checker's probe-gated job, so a reconcile
	// triggered for any other reason can never hibernate a busy agent.
	running := shouldRun(agent.Annotations, r.config.AgentBase.IdleTimeout.AsDuration(), time.Now().UTC())

	// ADR-038: paired pods, rendered as a unit. Render the gateway first
	// so the agent's HTTPS_PROXY target exists by the time the agent pod
	// starts dialing it. ADR-041: pair-key NetworkPolicies are gone —
	// pair isolation is now enforced by the per-agent AuthorizationPolicy
	// on the gateway Service (mesh-level, cryptographic).
	// ADR-058: an api-server-set roll-rev annotation requests a rolling
	// restart. Stamp it into both pod templates so bumping it rolls the pair
	// (UI restart button, grant changes) without a spec/status write.
	rollRev := agent.Annotations[annRollRev]

	gatewaySS := BuildGatewayStatefulSet(name, !running, r.config, ownerRef, credentialSecrets)
	stampRollRev(gatewaySS, rollRev)
	gatewaySvc := BuildGatewayService(name, r.config, ownerRef)

	if err := r.applyStatefulSet(ctx, gatewaySS, running); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying gateway statefulset: %v", err))
	}
	// A single-replica gateway can CrashLoop on a stale revision, and default
	// StatefulSet rolling-update refuses to evict a NotReady pod — deadlocking
	// the rollout where the MaxUnavailableStatefulSet gate is off (k3s ≤ 1.35).
	// So evict the stuck old-revision pod ourselves.
	if err := r.forceRollStuckPod(ctx, gatewaySS.Namespace, gatewaySS.Name); err != nil {
		slog.Warn("force-rolling stuck gateway pod failed; rollout may be deadlocked",
			"namespace", gatewaySS.Namespace, "statefulset", gatewaySS.Name, "error", err)
	}
	timer.mark("gatewayStatefulSet")
	// Apply gateway Service + migrate any legacy headless instance, return
	// the live object so we capture the assigned ClusterIP synchronously.
	liveGatewaySvc, err := ensureGatewayService(ctx, r.client, gatewaySvc, "agent", name)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("ensuring gateway service: %v", err))
	}
	gatewayIP := liveGatewaySvc.Spec.ClusterIP
	timer.mark("gatewayService")

	// HTTPS_PROXY + init containers need the gateway ClusterIP — normally
	// assigned synchronously at Service create. If not yet, requeue quietly: a
	// transient wait, not an error (don't stamp ReconcileError, or the api-server
	// flashes a brief "error" on a starting agent). A persistent failure still
	// escalates via the reconcile backoff cap.
	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("agent %s: gateway Service ClusterIP not yet assigned, requeuing", name)
	}

	// #692: back matching persisted mounts with a pre-provisioned warm-pool PVC
	// so a new agent skips the dynamic-provisioning wait. A lookup error requeues.
	claims, err := r.resolveWorkspaceClaims(ctx, agent, agentSpec)
	if err != nil {
		return r.setError(ctx, name, fmt.Sprintf("resolving warm-pool claims: %v", err))
	}
	timer.mark("workspaceClaims")
	agentSS := BuildAgentStatefulSet(name, agentSpec, r.config, ownerRef, gatewayIP)
	applyPoolClaims(agentSS, claims)
	stampRollRev(agentSS, rollRev)
	agentSvc := BuildAgentService(name, r.config, ownerRef)
	if err := r.applyStatefulSet(ctx, agentSS, running); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying agent statefulset: %v", err))
	}
	if err := r.applyService(ctx, agentSvc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying agent service: %v", err))
	}
	timer.mark("agentStatefulSet")

	// ADR-058: the reconciler only scales up; scale-down and the Hibernated
	// readiness reason are the idle checker's job. So readiness is published
	// only for a running agent — but rendering succeeded either way, so an idle
	// agent still records Reconciled rather than keeping a stale error.
	if running {
		err = r.publishReadiness(ctx, agent)
		timer.mark("readiness")
		return err
	}
	err = r.publishReconciled(ctx, agent)
	timer.mark("reconciled")
	return err
}

// publishReadiness observes the agent + gateway StatefulSet rollouts and
// publishes the readiness conditions (ADR-059). Ready = AgentPodReady ∧
// GatewayPodReady — the agent cannot make credentialed egress without its
// gateway, so both are required. The pod informer re-enqueues the agent on pod
// transitions, so this runs again as pods come up and Phase advances Pending →
// Running. The api-server routes on ConditionReady (superseding ADR-032's
// pod-only live check).
func (r *AgentReconciler) publishReadiness(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	gen := agent.Generation
	// Readiness reflects the StatefulSet's *observed rollout*, not any intent
	// marker: a pod counts only when it's Ready AND on the latest revision the
	// StatefulSet has rolled out (ADR-059). This is correct regardless of who
	// changed the Agent (api-server, kubectl, GitOps) or how (roll-rev, spec
	// edit, credential set) — every change to the rendered template bumps the
	// StatefulSet revision, so a still-Ready pod on a superseded revision reads
	// as not-ready until the new revision is up.
	agentReady := r.podCurrentAndReady(ctx, name)
	gatewayReady := r.podCurrentAndReady(ctx, GatewayName(name))
	ready := agentReady && gatewayReady

	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, agentReady, "PodReady", "PodNotReady", "", gen)
		setStatusCondition(s, apiv1.ConditionGatewayPodReady, gatewayReady, "PodReady", "PodNotReady", "", gen)
		setStatusCondition(s, apiv1.ConditionReady, ready, "AllPodsReady", "PodsNotReady", "", gen)
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.ObservedGeneration = gen
	})
}

// publishReconciled records that the spec was accepted and rendered, without
// touching readiness — for a not-running (idle) agent, whose readiness
// conditions are the idle checker's to write.
func (r *AgentReconciler) publishReconciled(ctx context.Context, agent *apiv1.Agent) error {
	gen := agent.Generation
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.ObservedGeneration = gen
	})
}

// podCurrentAndReady reports whether the StatefulSet's single pod is Ready AND
// on the latest revision the StatefulSet has rolled out. It returns false while
// a change is still being applied — either the StatefulSet controller hasn't
// yet observed the newest template (ObservedGeneration < Generation) or the
// running pod is on a superseded revision (controller-revision-hash !=
// UpdateRevision). Reading the *observed* revision rather than an intent marker
// makes this correct no matter who mutated the source (api-server, kubectl,
// GitOps) or what changed it (roll-rev, spec edit, credential set): every
// change to the rendered template bumps the revision the StatefulSet rolls to.
func (r *AgentReconciler) podCurrentAndReady(ctx context.Context, ssName string) bool {
	ss, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, ssName, metav1.GetOptions{})
	if err != nil {
		return false
	}
	if ss.Status.ObservedGeneration != ss.Generation {
		return false
	}
	pod, err := r.client.CoreV1().Pods(r.config.Namespace).Get(ctx, ssName+"-0", metav1.GetOptions{})
	if err != nil {
		return false
	}
	return isPodReady(*pod) &&
		pod.Labels["controller-revision-hash"] == ss.Status.UpdateRevision
}

// ensureLeafSecretOwnerReference adds a non-controller OwnerReference from
// the cert-manager-produced envoy leaf TLS Secret to the owning Agent, so
// that deleting the agent cascade-deletes the Secret. Returns nil if
// the Secret does not exist yet (cert-manager has not finished issuing —
// the next reconcile will retry). The ref is non-controller (the Certificate
// is the Secret's controller) so K8s GC reaps it without an ownership conflict.
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
	// We clean them up explicitly here. (In-flight forks are owner-refed to
	// the Agent CR, so K8s GC reaps them — see ensureForkOwnerReference.)
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

// resolveWorkspaceClaims returns the sanitized-mount-name → warm-pool-PVC-name
// map backing an agent's persisted mounts (#692); an empty map means "provision
// dynamically" (unchanged behavior). The decision is made once at create; once
// the StatefulSet exists its volume/volumeClaimTemplate split is immutable, so
// the map is rebuilt from the live StatefulSet (not PVC labels) and intersected
// with the currently-persisted mounts — keeping the template byte-identical
// across wake/hibernate, even if a claimed PVC is deleted out-of-band.
func (r *AgentReconciler) resolveWorkspaceClaims(ctx context.Context, agent *apiv1.Agent, agentSpec *apiv1.AgentSpec) (map[string]string, error) {
	name := agent.Name
	defaults := r.config.AgentTemplateDefaults

	// Mounts the spec currently persists; every returned claim is intersected with this.
	persisted := map[string]bool{}
	for _, mnt := range resolveSpecMounts(agentSpec, defaults) {
		if mnt.Persist {
			persisted[types.SanitizeMountName(mnt.Path)] = true
		}
	}

	// If the StatefulSet exists, the decision is frozen in its pod-template
	// volume / volumeClaimTemplate split — reconstruct from the live object.
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

	// StatefulSet not created yet: recover any already-claimed spare (crash-safety),
	// then — first create only, when enabled — claim one per remaining matching mount.
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
			continue // already recovered above
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

// listClaimedPoolPVCs maps mount → PVC name for an agent's pool-claimed PVCs
// (those carrying LabelPool + LabelMount alongside LabelAgent).
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

// claimSpare atomically claims one Bound available spare for poolKey: it stamps
// LabelAgent + LabelMount and drops the available marker in a resourceVersion-
// checked update. A lost race (Conflict/NotFound) tries the next candidate; an
// empty pool returns "" so the caller falls back to dynamic provisioning.
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

// ReconcileOrphanPVCs deletes any PVC labeled `agent-platform.ai/agent=<name>` whose
// Agent CR no longer exists. Covers two leak modes (issue #244):
// the controller crashing between StatefulSet teardown and PVC deletion, and
// users removing the Agent out-of-band (e.g. via kubectl).
//
// Safe against the create-PVC-before-finalize race because we re-read the
// Agent from the API server (not the informer cache) before deleting.
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

// ReconcileOrphanLeafSecrets deletes any per-agent envoy leaf TLS
// Secret whose Agent CR no longer exists. Covers historical
// leaks from before owner-references were added to these Secrets, plus
// any future Secret that slips through (e.g. cert-manager produced the
// Secret between the controller patching the ownerRef and the agent
// being deleted, or the controller crashed in that window).
//
// Match is intentionally tight: Secret name ends in `-envoy-tls`, type
// is `kubernetes.io/tls`, and the prefix names a non-existent
// Agent. Anything else is left alone.
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
	// Surface the failure on the Reconciled condition (message carries the
	// error). The returned error also drives the work queue's rate-limited retry.
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		// Don't downgrade a terminal BackoffLimitExceeded back to ReconcileError:
		// the flip-flop self-triggers via the informer and stops the backed-off
		// agent from settling. It clears on the next successful reconcile.
		if c := apimeta.FindStatusCondition(s.Conditions, apiv1.ConditionReconciled); c != nil && c.Reason == "BackoffLimitExceeded" {
			return
		}
		setStatusCondition(s, apiv1.ConditionReconciled, false, "Reconciled", "ReconcileError", msg, 0)
	}); err != nil {
		slog.Warn("writing agent reconcile-error status", "agent", name, "error", err)
	}
	return fmt.Errorf("agent %s: %s", name, msg)
}

// SetBackoffExceeded stamps Reconciled=False/BackoffLimitExceeded once the work
// queue's retry budget is spent (mirrors a Job). Retries continue at the capped
// backoff + resync cadence; the condition clears on the next successful reconcile.
func (r *AgentReconciler) SetBackoffExceeded(ctx context.Context, name string, attempts int, cause error) {
	msg := fmt.Sprintf("reconcile failed %d times, retrying with capped backoff: %v", attempts, cause)
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReconciled, false, "Reconciled", "BackoffLimitExceeded", msg, 0)
	}); err != nil {
		slog.Warn("writing agent backoff-exceeded status", "agent", name, "error", err)
	}
}

// stampRollRev writes the roll-rev value into a StatefulSet's pod-template
// annotations (ADR-058). A changed value diverges the template, so the
// StatefulSet rolls its pod; an empty value is left unset so untouched agents
// don't churn. applyStatefulSet propagates the template, so this reaches
// already-running pairs too.
func stampRollRev(ss *appsv1.StatefulSet, rollRev string) {
	if rollRev == "" {
		return
	}
	if ss.Spec.Template.Annotations == nil {
		ss.Spec.Template.Annotations = map[string]string{}
	}
	ss.Spec.Template.Annotations[annRollRev] = rollRev
}

// applyStatefulSet creates or updates a StatefulSet, owning its replica count
// per the activity-driven model (ADR-058). When `running` is true it scales the
// StatefulSet to 1; when false it *preserves* the existing replica count rather
// than forcing 0 — so the reconciler can wake an agent but never hibernates
// one. Scale-down is the idle checker's probe-gated responsibility.
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
		// Scale up on activity; otherwise leave replicas as the idle checker
		// (or a prior reconcile) set them.
		if running {
			one := int32(1)
			existing.Spec.Replicas = &one
		}
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
