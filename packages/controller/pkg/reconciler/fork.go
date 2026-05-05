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
	"gopkg.in/yaml.v3"

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

func (r *ForkReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	forkName := cm.Name

	currentPhase := readForkPhase(cm)
	if currentPhase == types.ForkPhaseFailed || currentPhase == types.ForkPhaseCompleted {
		return nil
	}

	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, "no spec.yaml in ConfigMap")
	}
	forkSpec, err := types.ParseForkSpec(specYAML)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	instanceCM, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, forkSpec.Instance, metav1.GetOptions{})
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("instance %q not found: %v", forkSpec.Instance, err))
	}
	instanceSpecYAML, ok := instanceCM.Data["spec.yaml"]
	if !ok {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("instance %q has no spec.yaml", forkSpec.Instance))
	}
	instanceSpec, err := types.ParseInstanceSpec(instanceSpecYAML)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("parsing instance %q: %v", forkSpec.Instance, err))
	}

	agentName := instanceCM.Labels["agent-platform.ai/agent"]
	if agentName == "" {
		agentName = instanceSpec.AgentName
	}
	_, agentSpec, err := r.resolver.Resolve(agentName)
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

	if !hasGitHubCredential(credentialSecrets) {
		slog.Warn("fork: replier has no GitHub credential Secret; gh/octokit calls will be unauthenticated",
			"fork", forkName, "foreignSub", forkSpec.ForeignSub)
	}

	bootstrapCM, err := BuildEnvoyBootstrapConfigMap(forkName, r.config, cm, credentialSecrets)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("rendering envoy bootstrap: %v", err))
	}
	if err := r.applyConfigMap(ctx, bootstrapCM); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying envoy bootstrap: %v", err))
	}
	if cert := BuildEnvoyLeafCertificate(forkName, r.config, cm, credentialSecrets); cert != nil {
		if err := r.applyCertificate(ctx, cert); err != nil {
			return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying envoy leaf certificate: %v", err))
		}
	}

	desired := BuildForkJob(forkName, forkSpec, instanceSpec, agentSpec, r.config, cm, credentialSecrets)

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
		return WriteForkStatus(ctx, r.client, r.config.Namespace, forkName,
			types.NewForkStatus(types.ForkPhaseReady, forkName, pod.Status.PodIP, nil))
	}

	if age := r.now().Sub(cm.CreationTimestamp.Time); age > ForkPodReadyTimeout {
		return r.setForkFailed(ctx, forkName, types.ForkReasonTimeout,
			fmt.Sprintf("pod not Ready after %s", ForkPodReadyTimeout))
	}

	if currentPhase == "" {
		return WriteForkStatus(ctx, r.client, r.config.Namespace, forkName,
			types.NewForkStatus(types.ForkPhasePending, forkName, "", nil))
	}
	return nil
}

func (r *ForkReconciler) Delete(_ context.Context, name string) {
	slog.Info("fork configmap deleted; job is GC'd via owner reference", "fork", name)
}

func (r *ForkReconciler) setForkFailed(ctx context.Context, name, reason, detail string) error {
	status := types.NewForkStatus(types.ForkPhaseFailed, "", "", &types.ForkError{Reason: reason, Detail: detail})
	if err := WriteForkStatus(ctx, r.client, r.config.Namespace, name, status); err != nil {
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

func readForkPhase(cm *corev1.ConfigMap) string {
	statusYAML, ok := cm.Data["status.yaml"]
	if !ok {
		return ""
	}
	var s types.ForkStatus
	if err := yaml.Unmarshal([]byte(statusYAML), &s); err != nil {
		return ""
	}
	return s.Phase
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

// applyConfigMap mirrors `InstanceReconciler.applyConfigMap` for fork-scoped
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

// applyCertificate mirrors `InstanceReconciler.applyCertificate` for fork-scoped
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
