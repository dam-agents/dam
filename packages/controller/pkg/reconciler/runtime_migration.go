package reconciler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: moving an Agent from the container Backend to the vm one. The api-server is the one spec writer, so it flips the Backend and stamps the request in one patch; everything after is the controller's, and each phase is derived from cluster state so a restart resumes where it left off. `requested` takes the old pod down and records which volume holds HOME; `copying` creates the machine stopped and runs a Job that streams that volume to the owner's runner, where it waits as the machine's seed; `booting` lets the machine start, and platform-init seeds the fresh disk from it rather than from the image. The old volume is released only once the machine has answered, so a boot that fails still has the agent's work to fall back on, and even then it is retained for a window rather than deleted.
const (
	annRuntimeMigration        = "agent-platform.ai/runtime-migration"
	annRuntimeMigrationMessage = "agent-platform.ai/runtime-migration-message"
	annRuntimeMigrationSource  = "agent-platform.ai/runtime-migration-source"

	runtimeMigrationRequested = "requested"
	runtimeMigrationCopying   = "copying"
	runtimeMigrationBooting   = "booting"

	// UNIT_BOUNDARY_DESCRIPTION: the role the copy Job's pod carries, which is what the owner's runner admits to its machine API besides the api-server and the controller. Only the controller creates pods with it, and it is paired with the owner label, so one owner's Job never reaches another owner's runner.
	RoleRuntimeMigration = "runtime-migration"

	// UNIT_BOUNDARY_DESCRIPTION: where the copy Job finds what it runs and reads. vm-seed ships in the runner image, so the Job carries exactly the tar writer the runner's reader was tested against.
	runtimeMigrationSeedBinary = "/usr/local/bin/vm-seed"
	runtimeMigrationSourcePath = "/mnt/home"
	runtimeMigrationCredsPath  = "/etc/vm-seed"
)

// UNIT_BOUNDARY_DESCRIPTION: until the seed is on the runner, nothing may run: the old pod would keep writing to a volume that is being copied, and a machine that booted would seed its disk from the image and never look at the copy again.
func runtimeMigrationHoldsDown(annotations map[string]string) bool {
	switch annotations[annRuntimeMigration] {
	case "", runtimeMigrationBooting:
		return false
	default:
		return true
	}
}

func runtimeMigrationJobName(agentName string) string {
	name := "rtm-" + agentName
	if len(name) > 63 {
		name = name[:63]
	}
	return name
}

// UNIT_BOUNDARY_DESCRIPTION: the `requested` phase, run before the machine is ensured. It is idempotent: the source volume is recorded once, while the old StatefulSet still names it, and the headless Service a pod needed is removed so the vm reconcile creates the ClusterIP one a machine needs. It moves on only once the old pod is gone.
func (r *AgentReconciler) prepareRuntimeMigration(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	if agent.Annotations[annRuntimeMigration] != runtimeMigrationRequested {
		return nil
	}
	patch := map[string]*string{}
	if agent.Annotations[annRuntimeMigrationSource] == "" {
		source, err := r.runtimeMigrationSource(ctx, agent)
		if err != nil {
			return r.noteRuntimeMigration(ctx, name, err)
		}
		patch[annRuntimeMigrationSource] = new(source)
	}
	ns := r.config.Namespace
	if err := r.client.AppsV1().StatefulSets(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("deleting the container statefulset: %w", err)
	}
	svc, err := r.client.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
	if err == nil && svc.Spec.ClusterIP == corev1.ClusterIPNone {
		if err := r.client.CoreV1().Services(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
			return fmt.Errorf("deleting the headless agent service: %w", err)
		}
	} else if err != nil && !k8serrors.IsNotFound(err) {
		return err
	}
	pods, err := r.client.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + name + "," + LabelRole + "=" + RoleAgent,
	})
	if err != nil {
		return err
	}
	if len(pods.Items) == 0 {
		patch[annRuntimeMigration] = new(runtimeMigrationCopying)
		slog.Info("runtime migration: container pod gone, copying home", "agent", name)
	}
	if len(patch) == 0 {
		return nil
	}
	return patchAgentAnnotations(ctx, r.dynamic, ns, name, patch)
}

// UNIT_BOUNDARY_DESCRIPTION: the volume that holds HOME. Both a StatefulSet's own claim and a warm-pool claim carry the agent and mount labels, so they are found the same way; the StatefulSet, while it exists, says which one the pod mounted when a second one is somehow also labelled.
func (r *AgentReconciler) runtimeMigrationSource(ctx context.Context, agent *apiv1.Agent) (string, error) {
	mount := sanitizeMountName(agentHomeDir)
	list, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + agent.Name + "," + LabelMount + "=" + mount,
	})
	if err != nil {
		return "", err
	}
	if len(list.Items) == 1 {
		return list.Items[0].Name, nil
	}
	if len(list.Items) == 0 {
		return "", fmt.Errorf("no volume holds this agent's home (%s), so there is nothing to copy", agentHomeDir)
	}
	sts, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, agent.Name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("%d volumes are labelled as this agent's home and the statefulset that says which is in use is gone", len(list.Items))
	}
	for _, v := range sts.Spec.Template.Spec.Volumes {
		if v.Name == mount && v.PersistentVolumeClaim != nil {
			return v.PersistentVolumeClaim.ClaimName, nil
		}
	}
	return "", fmt.Errorf("%d volumes are labelled as this agent's home and its statefulset mounts none of them", len(list.Items))
}

// UNIT_BOUNDARY_DESCRIPTION: the `copying` and `booting` phases, run after the machine is ensured, since both read what the runner said about it. A copy waits for the machine to exist and be stopped — the runner refuses a seed otherwise — and on success moves to `booting` with a fresh activity stamp, so the machine boots once even for an agent that was asleep: the copy is only proven by a guest that seeded from it. `booting` ends when the guest answers; the seed is removed then, and not before, and the old volume is retained for its window.
func (r *AgentReconciler) continueRuntimeMigration(ctx context.Context, agent *apiv1.Agent, machine vmrunner.MachineStatus, runnerReached bool) error {
	name := agent.Name
	if !runnerReached {
		return nil
	}
	switch agent.Annotations[annRuntimeMigration] {
	case runtimeMigrationCopying:
		if machine.State != vmrunner.StateStopped {
			return nil
		}
		return r.runRuntimeMigrationCopy(ctx, agent)
	case runtimeMigrationBooting:
		if machine.Ready {
			return r.finishRuntimeMigration(ctx, agent)
		}
		if machine.Reason == vmrunner.ReasonBootFailed || machine.Reason == vmrunner.ReasonImageUnavailable || machine.Reason == vmrunner.ReasonOutOfCapacity {
			msg := machine.Message
			if msg == "" {
				msg = machine.Reason
			}
			return r.noteRuntimeMigration(ctx, name, fmt.Errorf("the new machine has not started: %s", msg))
		}
	}
	return nil
}

func (r *AgentReconciler) runRuntimeMigrationCopy(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	source := agent.Annotations[annRuntimeMigrationSource]
	if source == "" {
		return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{annRuntimeMigration: new(runtimeMigrationRequested)})
	}
	jobs := r.client.BatchV1().Jobs(r.config.Namespace)
	job, err := jobs.Get(ctx, runtimeMigrationJobName(name), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		if err := ensureMigrationServiceAccount(ctx, r.client, r.config.Namespace); err != nil {
			return err
		}
		desired := r.buildRuntimeMigrationJob(agent, owner, source)
		if _, err := jobs.Create(ctx, desired, metav1.CreateOptions{}); err != nil && !k8serrors.IsAlreadyExists(err) {
			return fmt.Errorf("creating the home copy job: %w", err)
		}
		slog.Info("runtime migration: home copy started", "agent", name, "pvc", source)
		return nil
	}
	if err != nil {
		return err
	}
	prop := metav1.DeletePropagationBackground
	switch {
	case jobConditionTrue(job, batchv1.JobComplete):
		if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
			return fmt.Errorf("deleting the home copy job: %w", err)
		}
		slog.Info("runtime migration: home copied, booting the machine", "agent", name)
		return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
			annRuntimeMigration:        new(runtimeMigrationBooting),
			annRuntimeMigrationMessage: nil,
			annLastActivity:            new(time.Now().UTC().Format(time.RFC3339)),
		})
	case jobConditionTrue(job, batchv1.JobFailed):
		reason := "copying the home directory failed; retrying"
		if why := r.copyJobFailure(ctx, job); why != "" {
			reason = fmt.Sprintf("copying the home directory failed (%s); retrying", why)
		}
		if err := r.noteRuntimeMigration(ctx, name, errors.New(reason)); err != nil {
			return err
		}
		if time.Since(job.CreationTimestamp.Time) < migrationJobRetryAfter {
			return nil
		}
		slog.Warn("runtime migration: deleting failed home copy job for retry", "agent", name, "job", job.Name)
		return jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop})
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: why the copy Job's last attempt failed, in vm-seed's own words: the error it exits with and every cause under it, which the container's termination message carries. A failure that is only ever reported as "failed" cannot be told apart from the next one, and the Job's pods are gone once its time to live runs out. Empty when no attempt left a message.
func (r *AgentReconciler) copyJobFailure(ctx context.Context, job *batchv1.Job) string {
	pods, err := r.client.CoreV1().Pods(job.Namespace).List(ctx, metav1.ListOptions{LabelSelector: batchv1.JobNameLabel + "=" + job.Name})
	if err != nil {
		return ""
	}
	var last *corev1.ContainerStateTerminated
	for i := range pods.Items {
		for _, cs := range pods.Items[i].Status.ContainerStatuses {
			t := cs.State.Terminated
			if t != nil && t.Message != "" && (last == nil || t.FinishedAt.After(last.FinishedAt.Time)) {
				last = t
			}
		}
	}
	if last == nil {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(last.Message), "\n")
	from := len(lines) - 1
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.HasPrefix(strings.TrimSpace(lines[i]), "Error:") {
			from = i
			break
		}
	}
	var parts []string
	for _, l := range lines[from:] {
		if l = strings.TrimSpace(l); l != "" && l != "Caused by:" {
			parts = append(parts, l)
		}
	}
	msg := strings.Join(parts, "; ")
	if len(msg) > copyFailureMax {
		msg = msg[:copyFailureMax] + "…"
	}
	return msg
}

const copyFailureMax = 300

func (r *AgentReconciler) finishRuntimeMigration(ctx context.Context, agent *apiv1.Agent) error {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	runner, err := r.runnerFor(ctx, owner)
	if err != nil {
		return err
	}
	if err := runner.DeleteSeed(ctx, name); err != nil {
		return err
	}
	until := time.Now().Add(r.migrationRetention())
	if source := agent.Annotations[annRuntimeMigrationSource]; source != "" {
		if err := r.retainMigratedVolume(ctx, agent, source, agentHomeDir, until); err != nil {
			return err
		}
	}
	slog.Info("runtime migration: agent moved to the vm backend", "agent", name)
	return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigration:        nil,
		annRuntimeMigrationMessage: nil,
		annRuntimeMigrationSource:  nil,
	})
}

// UNIT_BOUNDARY_DESCRIPTION: what the user is shown while a migration is stuck. The phase stays where it is and the step is retried, so the message is advice about the present, cleared as soon as the step it describes gets past it.
func (r *AgentReconciler) noteRuntimeMigration(ctx context.Context, name string, cause error) error {
	msg := cause.Error()
	slog.Warn("runtime migration: step not done", "agent", name, "reason", msg)
	return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{annRuntimeMigrationMessage: new(msg)})
}

// UNIT_BOUNDARY_DESCRIPTION: the Job reads the old volume read-only as root — HOME holds files owned by the agent's user with private modes, and the tar has to carry them exactly — and reaches only the owner's runner, with the runner's token and the CA that signed its serving certificate. It runs where the agent's pods run, since that is where its volume attaches.
func (r *AgentReconciler) buildRuntimeMigrationJob(agent *apiv1.Agent, owner, source string) *batchv1.Job {
	name := agent.Name
	cfg := r.config
	spec := cfg.VM.Runner
	labels := map[string]string{
		LabelMigrationFor:              name,
		LabelRole:                      RoleRuntimeMigration,
		envoyOwnerLabel:                owner,
		"agent-platform.ai/managed-by": "platform-controller",
	}
	podLabels := map[string]string{"istio.io/dataplane-mode": "none"}
	for k, v := range labels {
		podLabels[k] = v
	}
	backoff := int32(2)
	ttl := int32(600)
	deadline := int64(migrationJobDeadline.Seconds())
	rootUID := int64(0)
	url := fmt.Sprintf("https://%s:%d/machines/%s/seed", r.runnerHost(owner), vmRunnerPort, name)
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:            runtimeMigrationJobName(name),
			Namespace:       cfg.Namespace,
			OwnerReferences: []metav1.OwnerReference{agentOwnerRef(agent)},
			Labels:          labels,
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			ActiveDeadlineSeconds:   &deadline,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: podLabels},
				Spec: corev1.PodSpec{
					RestartPolicy:                corev1.RestartPolicyNever,
					ServiceAccountName:           migrationServiceAccount,
					AutomountServiceAccountToken: new(false),
					EnableServiceLinks:           new(false),
					ImagePullSecrets:             spec.ImagePullSecrets,
					SecurityContext:              &corev1.PodSecurityContext{RunAsUser: &rootUID},
					Containers: []corev1.Container{{
						Name:                     "seed",
						Image:                    spec.Image,
						TerminationMessagePolicy: corev1.TerminationMessageFallbackToLogsOnError,
						ImagePullPolicy:          corev1.PullPolicy(spec.ImagePullPolicy),
						Command: []string{
							runtimeMigrationSeedBinary,
							"--source", runtimeMigrationSourcePath,
							"--url", url,
							"--token-file", runtimeMigrationCredsPath + "/token",
							"--ca-file", runtimeMigrationCredsPath + "/ca.crt",
						},
						VolumeMounts: []corev1.VolumeMount{
							{Name: "home", MountPath: runtimeMigrationSourcePath, ReadOnly: true},
							{Name: "credentials", MountPath: runtimeMigrationCredsPath, ReadOnly: true},
						},
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("100m"),
								corev1.ResourceMemory: resource.MustParse("64Mi"),
							},
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("1"),
								corev1.ResourceMemory: resource.MustParse("256Mi"),
							},
						},
					}},
					Volumes: []corev1.Volume{
						{Name: "home", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: source, ReadOnly: true}}},
						{Name: "credentials", VolumeSource: corev1.VolumeSource{Projected: &corev1.ProjectedVolumeSource{
							DefaultMode: new(int32(0o400)),
							Sources: []corev1.VolumeProjection{
								{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerName(owner)}, Items: []corev1.KeyToPath{{Key: "token", Path: "token"}}}},
								{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerTLSName(owner)}, Items: []corev1.KeyToPath{{Key: "ca.crt", Path: "ca.crt"}}}},
							},
						}}},
					},
				},
			},
		},
	}
	applyAgentBaseScheduling(&job.Spec.Template.Spec, cfg.AgentBase)
	job.Spec.Template.Spec.RuntimeClassName = nil
	return job
}
