package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

const (
	// RunPodReadyTimeout bounds how long the executor pod has to reach Ready
	// before the Run is failed.
	RunPodReadyTimeout = 120 * time.Second
	// RunMaxLifetime is a hard GC backstop: the api-server deletes a Run CR when
	// the dam-run stream closes, but if the api-server crashed mid-run the CR
	// (and its pod) would otherwise leak. The controller reaps any Run older
	// than this regardless. A dam-run that needs longer than an hour is out of
	// scope for this lifetime model.
	RunMaxLifetime = 60 * time.Minute
)

// RunReconciler materialises the executor behind the in-pod `dam-run` CLI. It is
// deliberately lighter than ForkReconciler: the executor runs as the parent
// Agent's own owner and routes egress through the parent's already-running
// gateway, so it needs no gateway/cert/SA/AuthorizationPolicy of its own — just
// a bare Pod plus one egress NetworkPolicy admitting it to the parent gateway.
// Recursion (an executor spawning executors) is bounded by the api-server's
// per-agent concurrency cap.
type RunReconciler struct {
	client   kubernetes.Interface
	dynamic  dynamic.Interface
	config   *config.Config
	resolver *AgentResolver
	now      func() time.Time
}

func NewRunReconciler(client kubernetes.Interface, cfg *config.Config, resolver *AgentResolver) *RunReconciler {
	return &RunReconciler{client: client, config: cfg, resolver: resolver, now: time.Now}
}

// WithDynamicClient supplies the dynamic client used for status writes and the
// over-age reaper.
func (r *RunReconciler) WithDynamicClient(d dynamic.Interface) *RunReconciler {
	r.dynamic = d
	return r
}

func (r *RunReconciler) Reconcile(ctx context.Context, run *apiv1.Run) error {
	runName := run.Name
	ownerRef := runOwnerRef(run)

	phase := run.Status.Phase
	if phase == apiv1.RunPhaseFailed || phase == apiv1.RunPhaseCompleted {
		return nil
	}

	// Hard GC backstop for a Run the api-server never cleaned up. Deleting the
	// CR cascades to the executor pod + egress NetworkPolicy via ownerRefs.
	if age := r.now().Sub(run.CreationTimestamp.Time); age > RunMaxLifetime {
		slog.Warn("reaping over-age run", "run", runName, "age", age.String())
		if err := r.dynamic.Resource(RunsGVR).Namespace(r.config.Namespace).
			Delete(ctx, runName, metav1.DeleteOptions{}); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("reaping run %s: %w", runName, err)
		}
		return nil
	}

	parentAgentID := run.Spec.AgentName
	parentAgent, agentSpec, err := r.resolver.Resolve(parentAgentID)
	if err != nil {
		return r.setRunFailed(ctx, runName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	// Route through the parent's already-running gateway (IP-direct, no DNS).
	gwSvc, err := r.client.CoreV1().Services(r.config.Namespace).Get(ctx, GatewayName(parentAgentID), metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("run %s: reading parent gateway service: %w", runName, err)
	}
	gatewayIP := gwSvc.Spec.ClusterIP
	if gatewayIP == "" || gatewayIP == corev1.ClusterIPNone {
		return fmt.Errorf("run %s: parent gateway ClusterIP not assigned, requeuing", runName)
	}

	// Credential placeholder env mirrors the parent's grants; real injection
	// happens at the shared parent gateway.
	credentialSecrets, err := listAgentCredentialSecrets(ctx, r.client, r.config.Namespace, parentAgent.Labels[envoyOwnerLabel],
		agentSpec.GrantedSecretIDs, agentSpec.GrantedConnectionIDs)
	if err != nil {
		return r.setRunFailed(ctx, runName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("listing credential secrets: %v", err))
	}

	// One owned resource beyond the pod: an egress NetworkPolicy admitting the
	// executor (pair=runName) to the parent gateway (pair=parentAgentID).
	if err := applyNetworkPolicy(ctx, r.client, buildAgentEgressNetworkPolicyTo(runName, parentAgentID, r.config, ownerRef)); err != nil {
		return r.setRunFailed(ctx, runName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	desired := BuildRunExecutorPod(runName, parentAgentID, agentSpec, r.config, ownerRef, credentialSecrets, gatewayIP)
	parentPVCs, err := resolveParentWorkspacePVCs(ctx, r.client, r.config, parentAgentID, agentSpec)
	if err != nil {
		return r.setRunFailed(ctx, runName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("resolving parent workspace PVCs: %v", err))
	}
	rewriteParentPVCs(desired.Spec.Volumes, parentPVCs)
	if err := createPodIfMissing(ctx, r.client, desired); err != nil {
		return r.setRunFailed(ctx, runName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying executor pod: %v", err))
	}

	pod, _ := findEphemeralPod(ctx, r.client, r.config.Namespace, RunLabelRunID, runName)
	if pod != nil && isPodReady(*pod) && pod.Status.PodIP != "" {
		return writeRunStatus(ctx, r.dynamic, r.config.Namespace, runName, apiv1.RunStatus{
			Phase: apiv1.RunPhaseReady, PodIP: pod.Status.PodIP,
		})
	}
	if _, msg, ok := terminationReason(pod); ok {
		return r.setRunFailed(ctx, runName, types.ForkReasonPodNotReady, msg)
	}
	if age := r.now().Sub(run.CreationTimestamp.Time); age > RunPodReadyTimeout {
		return r.setRunFailed(ctx, runName, types.ForkReasonTimeout,
			withPodTermination(fmt.Sprintf("pod not Ready after %s", RunPodReadyTimeout), pod))
	}
	if phase == "" {
		return writeRunStatus(ctx, r.dynamic, r.config.Namespace, runName, apiv1.RunStatus{Phase: apiv1.RunPhasePending})
	}
	return nil
}

// Delete is a no-op beyond logging: the executor pod and egress NetworkPolicy
// are owner-refed to the Run CR and reaped by K8s GC. Unlike forks, runs render
// nothing in the release namespace.
func (r *RunReconciler) Delete(_ context.Context, name string) {
	slog.Info("run deleted", "run", name)
}

func (r *RunReconciler) setRunFailed(ctx context.Context, name, reason, detail string) error {
	if err := writeRunStatus(ctx, r.dynamic, r.config.Namespace, name, apiv1.RunStatus{
		Phase: apiv1.RunPhaseFailed,
		Error: &apiv1.RunError{Reason: reason, Detail: detail},
	}); err != nil {
		slog.Error("writing run failed status", "run", name, "error", err)
	}
	return fmt.Errorf("run %s: %s: %s", name, reason, detail)
}
