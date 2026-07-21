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
	// busyProbe reports whether the fork's agent pod is mid-work and must not
	// have its pods reclaimed. Defaults to the live HTTP probe (podIsBusy);
	// overridable in tests, mirroring IdleChecker.
	busyProbe func(ctx context.Context, forkName string) bool
}

func NewForkReconciler(client kubernetes.Interface, cfg *config.Config, resolver *AgentResolver) *ForkReconciler {
	r := &ForkReconciler{client: client, config: cfg, resolver: resolver, now: time.Now}
	r.busyProbe = r.podIsBusy
	return r
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
	idleFor := r.now().Sub(forkLastActivity(fork))

	// Two-tier idle policy (#2843), evaluated on every reconcile — the 30s
	// informer resync is what advances a quiet fork through the tiers.
	//
	// Expire: idle past the long window → delete the CR; K8s GC sweeps the
	// Job, gateway Pod, Service, SA, netpol, bootstrap CM and leaf Cert
	// owner-refed to it. Runs ahead of the terminal-phase short-circuit so a
	// Failed CR the api-server never cleaned up ages out too. Busy-guarded
	// like hibernation — an in-flight turn is activity, however stale the
	// annotation.
	if r.config.ForkExpireAfter > 0 && idleFor >= r.config.ForkExpireAfter && !r.busyProbe(ctx, forkName) {
		stillIdle, err := r.confirmIdle(ctx, forkName, r.config.ForkExpireAfter)
		if err != nil {
			return err
		}
		if !stillIdle {
			return nil
		}
		slog.Info("expiring idle fork", "fork", forkName, "idle", idleFor.String())
		if err := r.dynamic.Resource(ForksGVR).Namespace(r.config.Namespace).
			Delete(ctx, forkName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("expiring fork %s: %w", forkName, err)
		}
		return nil
	}

	currentPhase := fork.Status.Phase
	if currentPhase == apiv1.ForkPhaseFailed || currentPhase == apiv1.ForkPhaseCompleted {
		return nil
	}

	// Hibernate: idle past the short window → tear down the pods (agent Job
	// + gateway Pod), retaining the CR and its identity resources for the
	// next wake. The busy probe guards a turn still running past the window;
	// an unreachable pod counts as not busy, the same fail-open trade the
	// agent idle checker makes.
	if r.config.ForkHibernateAfter > 0 && idleFor >= r.config.ForkHibernateAfter {
		if currentPhase == apiv1.ForkPhaseHibernated {
			return nil
		}
		if r.busyProbe(ctx, forkName) {
			slog.Info("fork idle by annotation but busy; skipping hibernation", "fork", forkName)
			return nil
		}
		stillIdle, err := r.confirmIdle(ctx, forkName, r.config.ForkHibernateAfter)
		if err != nil {
			return err
		}
		if !stillIdle {
			return nil
		}
		slog.Info("hibernating idle fork", "fork", forkName, "idle", idleFor.String())
		if err := r.deleteForkPods(ctx, forkName); err != nil {
			return err
		}
		return writeForkStatus(ctx, r.dynamic, r.config.Namespace, forkName, apiv1.ForkStatus{
			Phase: apiv1.ForkPhaseHibernated,
		})
	}

	timer := newReconcileTimer(ctx, "fork", forkName)
	defer timer.done()

	// K8s validated the spec at admission, so the controller trusts
	// the typed resource — no app-layer re-parse.
	forkSpec := &fork.Spec

	// The fork derives from a single Agent that carries both
	// definition and runtime fields. Resolve it directly.
	parentAgent, agentSpec, err := r.resolver.Resolve(forkSpec.AgentName)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	// Own the Fork by its parent Agent so K8s GC reaps an in-flight fork when
	// the Agent is deleted. Best-effort — retried on the next reconcile.
	if err := r.ensureForkOwnerReference(ctx, fork, parentAgent); err != nil {
		slog.Warn("setting fork owner reference", "fork", forkName, "agent", parentAgent.Name, "error", err)
	}

	// Load the replier's K8s credential Secrets and render the per-fork
	// bootstrap ConfigMap + leaf certificate. Secrets are scoped to
	// `foreignSub` — the parent owner's secrets must NOT appear here.
	// The per-fork
	// bootstrap/leaf names are derived from `forkName`, so the resources
	// are owned by the Fork CR and GC'd with it.
	credentialSecrets, err := listOwnerCredentialSecrets(ctx, r.client, r.config.Namespace, forkSpec.ForeignSub)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("listing replier credential secrets: %v", err))
	}
	timer.mark("credentials")

	// The fork gateway dials its OWN ext-authz Service (second arg), so the
	// Check's :authority carries the fork id and the api-server can tell a
	// replier's turn from the parent's (#2843).
	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(forkName, forkName, r.config, ownerRef, credentialSecrets)
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
	timer.mark("envoyBootstrap")

	// Per-fork ServiceAccount in the agent namespace. Forks get
	// their OWN identity (not the parent's) so a compromised fork cannot
	// reach the parent's full `/api/agents/<parent>/*` surface — only
	// the narrow paths the per-fork harness AuthorizationPolicy below
	// admits. Owner-refed to the Fork CR (same namespace), so
	// K8s GC reaps it on fork-cm delete.
	if err := r.ensureForkServiceAccount(ctx, forkName, ownerRef); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}
	timer.mark("serviceAccount")

	// Per-fork harness policy admits the fork SA only to the fork's own
	// `/api/agents/<forkId>/mcp` (never the parent's surface), and the
	// per-fork ext-authz policy admits the fork SA to the fork's own
	// ext-authz Service — the gate still resolves the parent owner's
	// rules from the fork id (#2843). Both gate the fork *gateway*'s
	// SPIFFE identity — the fork agent itself is not a mesh participant.
	if err := r.applyAuthorizationPolicy(ctx, BuildForkHarnessAuthorizationPolicy(forkName, forkSpec.AgentName, r.config, fork.Namespace, ownerRef)); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying fork harness authz policy: %v", err))
	}
	if err := r.applyAuthorizationPolicy(ctx, BuildForkExtAuthzAuthorizationPolicy(forkName, forkSpec.AgentName, r.config, fork.Namespace, ownerRef)); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying fork ext-authz authz policy: %v", err))
	}

	// Per-fork ext-authz Service (release namespace, no cross-namespace
	// ownerRef possible) — the destination the bootstrap above dials and the
	// policy above gates. Cleaned up in Delete alongside the policies.
	if err := applyExtAuthzService(ctx, r.client, BuildExtAuthzService(forkName, r.config)); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying fork ext-authz service: %v", err))
	}

	// Per-pair agent egress NetworkPolicy — same shape and rationale as
	// the long-lived pair: kernel-level boundary gating the agent → fork
	// gateway hop, agent has no ambient enrolment.
	if err := applyNetworkPolicy(ctx, r.client, BuildAgentEgressNetworkPolicy(forkName, r.config, ownerRef)); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}
	timer.mark("authzAndNetpol")

	// Paired gateway pod for the fork. Render the gateway-side
	// resources first so HTTPS_PROXY's target exists by the time the
	// agent Job's pod starts dialing it. Pair-key NetworkPolicy
	// is gone — pair isolation is now enforced by the AuthorizationPolicy
	// above.
	gatewayPod := BuildForkGatewayPod(forkName, forkSpec.AgentName, r.config, ownerRef, credentialSecrets)
	gatewaySvc := BuildForkGatewayService(forkName, r.config, ownerRef)

	// A durable fork's gateway outlives the replier's credential set: when
	// the secrets rev drifts (a connection added/removed since the pod
	// started), recreate the bare Pod so Envoy reloads its bootstrap —
	// the same roll the agent gateway gets from its StatefulSet template
	// hash. The brief egress blip matches an agent gateway roll. (The fork
	// agent Job's placeholder envs stay as-created; they refresh on the
	// next hibernate/wake cycle.)
	wantRev := gatewayPod.Annotations["agent-platform.ai/envoy-secrets-rev"]
	gatewayCurrent := false
	if existing, err := r.client.CoreV1().Pods(r.config.Namespace).Get(ctx, gatewayPod.Name, metav1.GetOptions{}); err == nil {
		if existing.DeletionTimestamp == nil && existing.Annotations["agent-platform.ai/envoy-secrets-rev"] != wantRev {
			slog.Info("rolling fork gateway on credential change", "fork", forkName)
			if err := r.client.CoreV1().Pods(r.config.Namespace).Delete(ctx, gatewayPod.Name, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
				return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("rolling gateway pod: %v", err))
			}
		} else if existing.DeletionTimestamp == nil {
			gatewayCurrent = true
		}
	} else if !errors.IsNotFound(err) {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("reading gateway pod: %v", err))
	}
	if !gatewayCurrent {
		// Mid-roll (or first create): the pair must not report Ready with a
		// stale or absent gateway — a relayed turn would egress without the
		// replier's current credentials. Park the status on Pending so the
		// api-server's watch holds the turn, and requeue to recreate as soon
		// as the old pod drains (5s grace).
		if err := createPodIfMissing(ctx, r.client, gatewayPod); err != nil {
			return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying gateway pod: %v", err))
		}
		fresh, err := r.client.CoreV1().Pods(r.config.Namespace).Get(ctx, gatewayPod.Name, metav1.GetOptions{})
		if err != nil || fresh.DeletionTimestamp != nil ||
			fresh.Annotations["agent-platform.ai/envoy-secrets-rev"] != wantRev {
			if currentPhase == apiv1.ForkPhaseReady {
				if err := writeForkStatus(ctx, r.dynamic, r.config.Namespace, forkName, apiv1.ForkStatus{
					Phase: apiv1.ForkPhasePending, JobName: forkName,
				}); err != nil {
					return err
				}
			}
			return fmt.Errorf("fork %s: gateway rolling, requeuing", forkName)
		}
	}
	// Apply gateway Service + migrate any legacy headless, capture
	// ClusterIP synchronously (see instance.go).
	liveGatewaySvc, err := ensureGatewayService(ctx, r.client, gatewaySvc, "fork", forkName)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("ensuring gateway service: %v", err))
	}
	gatewayIP := liveGatewaySvc.Spec.ClusterIP
	timer.mark("gateway")

	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("fork %s: gateway Service ClusterIP not yet assigned, requeuing", forkName)
	}

	desired := BuildForkAgentJob(forkName, forkSpec, agentSpec, r.config, ownerRef, credentialSecrets, gatewayIP)
	// #692: a warm-pool-claimed parent workspace PVC no longer follows the
	// `<mount>-<agent>-0` name BuildForkAgentJob assumes. Resolve each persisted
	// mount's PVC by label and rewrite the fork's claim refs (no-op for
	// pre-label agents — resolution falls back to the legacy name).
	parentPVCs, err := resolveParentWorkspacePVCs(ctx, r.client, r.config, forkSpec.AgentName, agentSpec)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("resolving parent workspace PVCs: %v", err))
	}
	rewriteParentPVCs(desired.Spec.Template.Spec.Volumes, parentPVCs)

	// Budget gate (#2843): a fork reserves against the REPLIER at the
	// parent's Size, checked at the 0→1 analog — Job creation, i.e. the
	// first start and every wake from hibernation; an existing Job means
	// the fork is already reserved and passes without reads. The owner lock
	// is held through the create so the reservation write lands inside it.
	// A denial fails the fork — no parking: the next reply rebuilds the
	// slot and re-gates.
	job, jobErr := r.client.BatchV1().Jobs(r.config.Namespace).Get(ctx, forkName, metav1.GetOptions{})
	if errors.IsNotFound(jobErr) {
		lock := ownerBudgetLock(forkSpec.ForeignSub)
		lock.Lock()
		verdict, verr := forkBudgetAllows(ctx, r.client, r.dynamic, r.config, forkSpec.ForeignSub, agentSpec)
		if verr == nil && verdict.allowed {
			verr = r.applyForkJob(ctx, desired)
		}
		lock.Unlock()
		if verr != nil {
			return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying job: %v", verr))
		}
		if !verdict.allowed {
			slog.Info("fork start refused: over budget", "fork", forkName, "replier", forkSpec.ForeignSub)
			return r.setForkFailed(ctx, forkName, types.ForkReasonOverBudget, verdict.message)
		}
		job, jobErr = r.client.BatchV1().Jobs(r.config.Namespace).Get(ctx, forkName, metav1.GetOptions{})
	}
	if jobErr != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("reading job: %v", jobErr))
	}
	timer.mark("forkJob")

	pod, _ := findEphemeralPod(ctx, r.client, r.config.Namespace, ForkLabelForkID, forkName)

	if isJobFailed(job) {
		return r.setForkFailed(ctx, forkName, types.ForkReasonPodNotReady, withPodTermination(jobFailureReason(job), pod))
	}

	if pod != nil && isPodReady(*pod) && pod.Status.PodIP != "" {
		// Durable forks re-reconcile on every resync; skip the redundant
		// status write while nothing changed.
		if currentPhase == apiv1.ForkPhaseReady && fork.Status.PodIP == pod.Status.PodIP {
			return nil
		}
		return writeForkStatus(ctx, r.dynamic, r.config.Namespace, forkName, apiv1.ForkStatus{
			Phase: apiv1.ForkPhaseReady, JobName: forkName, PodIP: pod.Status.PodIP,
		})
	}

	// The ready timeout applies only while the fork is *establishing*
	// (never reached Ready on this Job): an established Ready fork whose
	// pod blips unready — readiness probe hiccup under load — must ride
	// out the blip, not be torn down mid-turn; a real death surfaces as a
	// Job failure above (backoffLimit=0). Measured from the *Job's*
	// creation, never the CR's — a durable CR outlives many hibernate/wake
	// cycles, and each wake gets the full window.
	if currentPhase != apiv1.ForkPhaseReady {
		if age := r.now().Sub(job.CreationTimestamp.Time); age > ForkPodReadyTimeout {
			return r.setForkFailed(ctx, forkName, types.ForkReasonTimeout,
				withPodTermination(fmt.Sprintf("pod not Ready after %s", ForkPodReadyTimeout), pod))
		}
	}

	if currentPhase == "" || currentPhase == apiv1.ForkPhaseHibernated {
		return writeForkStatus(ctx, r.dynamic, r.config.Namespace, forkName, apiv1.ForkStatus{
			Phase: apiv1.ForkPhasePending, JobName: forkName,
		})
	}
	return nil
}

// confirmIdle re-reads the fork LIVE and re-evaluates its idleness
// immediately before a destructive transition: the reconcile object comes
// from the informer cache, so an activity bump (a wake) landing after that
// snapshot must veto the teardown it raced — otherwise a hibernate at the
// window boundary can delete the pods a just-relayed turn is about to use.
// Returns false when the fork is gone or no longer past the window.
func (r *ForkReconciler) confirmIdle(ctx context.Context, forkName string, window time.Duration) (bool, error) {
	u, err := r.dynamic.Resource(ForksGVR).Namespace(r.config.Namespace).Get(ctx, forkName, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("re-reading fork %s before teardown: %w", forkName, err)
	}
	live, err := FromCacheObject[apiv1.Fork](u)
	if err != nil {
		return false, fmt.Errorf("decoding fork %s: %w", forkName, err)
	}
	return r.now().Sub(forkLastActivity(live)) >= window, nil
}

// forkLastActivity returns the fork's last-activity annotation (bumped by the
// api-server per relayed turn), falling back to CR creation when absent or
// malformed. The fallback direction is deliberate: bad data at worst reclaims
// pods early, and the busy probe still guards an in-flight turn.
func forkLastActivity(fork *apiv1.Fork) time.Time {
	if v := fork.Annotations[annLastActivity]; v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			return t
		}
	}
	return fork.CreationTimestamp.Time
}

// deleteForkPods removes the fork's runnable surface — the agent Job (its
// pods cascade via background propagation) and the paired gateway Pod —
// leaving every identity resource (SA, leaf cert, policies, bootstrap CM,
// gateway Service) in place for the next wake. Idempotent.
func (r *ForkReconciler) deleteForkPods(ctx context.Context, forkName string) error {
	bg := metav1.DeletePropagationBackground
	if err := r.client.BatchV1().Jobs(r.config.Namespace).Delete(ctx, forkName,
		metav1.DeleteOptions{PropagationPolicy: &bg}); err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("deleting fork job %s: %w", forkName, err)
	}
	if err := r.client.CoreV1().Pods(r.config.Namespace).Delete(ctx, GatewayName(forkName),
		metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		return fmt.Errorf("deleting fork gateway pod %s: %w", GatewayName(forkName), err)
	}
	return nil
}

// podIsBusy probes the fork agent pod's runtime status endpoint by pod IP —
// fork pods are Job pods with no per-pod DNS. Unreachable or missing pods
// read as not busy (fail-open, matching the agent idle checker).
func (r *ForkReconciler) podIsBusy(ctx context.Context, forkName string) bool {
	pod, _ := findEphemeralPod(ctx, r.client, r.config.Namespace, ForkLabelForkID, forkName)
	if pod == nil || pod.Status.PodIP == "" {
		return false
	}
	return runtimeReportsBusy(ctx, fmt.Sprintf("http://%s:8080/api/status", pod.Status.PodIP))
}

func (r *ForkReconciler) Delete(ctx context.Context, name string) {
	// Agent-namespace resources (ServiceAccount, gateway Pod, agent Job,
	// gateway Service, agent-egress NetworkPolicy, Envoy bootstrap CM,
	// leaf Cert) are owner-refed to the Fork CR and reaped by K8s GC.
	//
	// Release-namespace per-fork policies (harness-allow, ext-authz-allow)
	// cannot use a cross-namespace ownerRef — same trap as the per-agent
	// resources in AgentReconciler.Delete. Clean them up explicitly.
	r.deleteReleaseNsForkResources(ctx, name)
	slog.Info("fork deleted", "fork", name)
}

// ensureForkOwnerReference adds an OwnerReference from the Fork CR to its parent
// Agent, so K8s GC reaps an in-flight fork when the Agent is deleted. Idempotent;
// mirrors AgentReconciler.ensureLeafSecretOwnerReference.
func (r *ForkReconciler) ensureForkOwnerReference(ctx context.Context, fork *apiv1.Fork, parent *apiv1.Agent) error {
	for _, ref := range fork.OwnerReferences {
		if ref.UID == parent.UID {
			return nil
		}
	}
	cli := r.dynamic.Resource(ForksGVR).Namespace(r.config.Namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		obj, err := cli.Get(ctx, fork.Name, metav1.GetOptions{})
		if err != nil {
			return err
		}
		refs := obj.GetOwnerReferences()
		for _, ref := range refs {
			if ref.UID == parent.UID {
				return nil
			}
		}
		obj.SetOwnerReferences(append(refs, metav1.OwnerReference{
			APIVersion: apiv1.GroupVersion.String(),
			Kind:       "Agent",
			Name:       parent.Name,
			UID:        parent.UID,
		}))
		_, err = cli.Update(ctx, obj, metav1.UpdateOptions{})
		return err
	})
}

// deleteReleaseNsForkResources removes the per-fork release-namespace
// resources — the harness + ext-authz AuthorizationPolicies and the
// per-fork ext-authz Service — which cannot ride a cross-namespace
// ownerRef. Errors are logged but not returned — fork deletion is
// best-effort.
func (r *ForkReconciler) deleteReleaseNsForkResources(ctx context.Context, forkName string) {
	if err := r.client.CoreV1().Services(r.config.ReleaseNamespace).
		Delete(ctx, r.config.ExtAuthzServiceName(forkName), metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
		slog.Warn("deleting per-fork ext-authz Service", "fork", forkName, "error", err)
	}
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
// Fork CR, label-drift heal).
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
	// A Failed CR may now linger until the api-server's next ensure or the
	// expiry sweep — tear the pods down so it holds no compute and no
	// crash-looping gateway meanwhile. Best-effort: the status write is the
	// authoritative signal.
	if err := r.deleteForkPods(ctx, name); err != nil {
		slog.Warn("tearing down failed fork pods", "fork", name, "error", err)
	}
	if err := writeForkStatus(ctx, r.dynamic, r.config.Namespace, name, apiv1.ForkStatus{
		Phase: apiv1.ForkPhaseFailed,
		Error: &apiv1.ForkError{Reason: reason, Detail: detail},
	}); err != nil {
		slog.Error("writing fork failed status", "fork", name, "error", err)
	}
	return fmt.Errorf("fork %s: %s: %s", name, reason, detail)
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

// withPodTermination appends the fork pod's abnormal-termination cause to a generic detail.
func withPodTermination(detail string, pod *corev1.Pod) string {
	if _, msg, ok := terminationReason(pod); ok {
		return fmt.Sprintf("%s: %s", detail, msg)
	}
	return detail
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
// for fork-scoped policies (per-fork gateway admission).
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
