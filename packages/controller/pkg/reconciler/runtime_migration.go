package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: moving an Agent from the container Backend to the vm one. The api-server is the one spec writer, so it flips the Backend and stamps the request in one patch; everything after is the controller's, and each phase is derived from cluster state so a restart resumes where it left off. `requested` takes the old pod down and records which volume holds HOME and which holds each other persisted path the api-server moved below it; `copying` creates the machine stopped and runs a Job that streams those volumes, as one tree, to the owner's runner, where it waits as the machine's seed; `booting` lets the machine start, and platform-init seeds the fresh disk from it rather than from the image. The old volume is released only once the machine has answered, so a boot that fails still has the agent's work to fall back on, and even then it is retained for a window rather than deleted.
const (
	annRuntimeMigration        = "agent-platform.ai/runtime-migration"
	annRuntimeMigrationMessage = "agent-platform.ai/runtime-migration-message"
	annRuntimeMigrationSource  = "agent-platform.ai/runtime-migration-source"
	annRuntimeMigrationMounts  = "agent-platform.ai/runtime-migration-mounts"
	annRuntimeMigrationGrafts  = "agent-platform.ai/runtime-migration-grafts"

	runtimeMigrationRequested = "requested"
	runtimeMigrationCopying   = "copying"
	runtimeMigrationBooting   = "booting"

	// UNIT_BOUNDARY_DESCRIPTION: the role the copy Job's pod carries, which is what the owner's runner admits to its machine API besides the api-server and the controller. Only the controller creates pods with it, and it is paired with the owner label, so one owner's Job never reaches another owner's runner.
	RoleRuntimeMigration = "runtime-migration"

	// UNIT_BOUNDARY_DESCRIPTION: where the copy Job finds what it runs and reads. vm-seed ships in the runner image, so the Job carries exactly the tar writer the runner's reader was tested against.
	runtimeMigrationSeedBinary = "/usr/local/bin/vm-seed"
	runtimeMigrationSourcePath = "/mnt/home"
	runtimeMigrationExtraPath  = "/mnt/extra"
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

// UNIT_BOUNDARY_DESCRIPTION: the `requested` phase, run before the machine is ensured. It is idempotent: the source volumes are recorded once, while the old StatefulSet still names them, and the headless Service a pod needed is removed so the vm reconcile creates the ClusterIP one a machine needs. It moves on only once the old pod is gone.
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
		grafts, err := r.runtimeMigrationGrafts(ctx, agent)
		if err != nil {
			return r.noteRuntimeMigration(ctx, name, err)
		}
		patch[annRuntimeMigrationSource] = new(source)
		if len(grafts) > 0 {
			encoded, err := json.Marshal(grafts)
			if err != nil {
				return err
			}
			patch[annRuntimeMigrationGrafts] = new(string(encoded))
		}
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
	source, err := r.runtimeMigrationVolume(ctx, agent, agentHomeDir)
	if err == nil && source == "" {
		return "", fmt.Errorf("no volume holds this agent's home (%s), so there is nothing to copy", agentHomeDir)
	}
	return source, err
}

// UNIT_BOUNDARY_DESCRIPTION: the volume the container backend mounted at `path`, or none when no volume was ever made for it.
func (r *AgentReconciler) runtimeMigrationVolume(ctx context.Context, agent *apiv1.Agent, path string) (string, error) {
	mount := sanitizeMountName(path)
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
		return "", nil
	}
	sts, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, agent.Name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("%d volumes are labelled as this agent's %s and the statefulset that says which is in use is gone", len(list.Items), path)
	}
	for _, v := range sts.Spec.Template.Spec.Volumes {
		if v.Name == mount && v.PersistentVolumeClaim != nil {
			return v.PersistentVolumeClaim.ClaimName, nil
		}
	}
	return "", fmt.Errorf("%d volumes are labelled as this agent's %s and its statefulset mounts none of them", len(list.Items), path)
}

// UNIT_BOUNDARY_DESCRIPTION: one more of the agent's volumes carried into the seed: the path the container mounted it at, where it goes relative to HOME on the machine, and the claim. The api-server, which rewrote the spec, says in the mounts annotation where each persisted path went; the claim is found by the old path, which is what its mount label was made from.
type runtimeMigrationGraft struct {
	From string `json:"from"`
	At   string `json:"at"`
	PVC  string `json:"pvc"`
}

// UNIT_BOUNDARY_DESCRIPTION: the grafts for every persisted path besides HOME that the api-server moved. A path the container never made a volume for has nothing to carry and is left out, so it starts empty on the machine as it would have in a fresh pod. A request from an api-server that predates the annotation moves HOME alone, as it always did.
func (r *AgentReconciler) runtimeMigrationGrafts(ctx context.Context, agent *apiv1.Agent) ([]runtimeMigrationGraft, error) {
	raw := agent.Annotations[annRuntimeMigrationMounts]
	if raw == "" {
		return nil, nil
	}
	var moved map[string]string
	if err := json.Unmarshal([]byte(raw), &moved); err != nil {
		return nil, fmt.Errorf("the migration's mounts annotation is not a map of paths: %w", err)
	}
	from := make([]string, 0, len(moved))
	for old := range moved {
		from = append(from, old)
	}
	sort.Strings(from)
	var grafts []runtimeMigrationGraft
	for _, old := range from {
		at, ok := strings.CutPrefix(moved[old], agentHomeDir+"/")
		if !ok || at == "" {
			return nil, fmt.Errorf("the migration moves %s to %s, which is not inside %s", old, moved[old], agentHomeDir)
		}
		pvc, err := r.runtimeMigrationVolume(ctx, agent, old)
		if err != nil {
			return nil, err
		}
		if pvc == "" {
			slog.Info("runtime migration: no volume was ever made for a persisted path, nothing to carry", "agent", agent.Name, "path", old)
			continue
		}
		grafts = append(grafts, runtimeMigrationGraft{From: old, At: at, PVC: pvc})
	}
	return grafts, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a persisted path from outside HOME and where below HOME it moved. The machine's root is fresh on every boot, so the copy Job has the seed carry a boot hook that links each such path to its new place again at every boot. Every moved path gets one, whether or not a volume was ever made for it, since the agent's software still looks there.
type runtimeMigrationLink struct {
	Path string `json:"path"`
	At   string `json:"at"`
}

func runtimeMigrationLinks(agent *apiv1.Agent) ([]runtimeMigrationLink, error) {
	raw := agent.Annotations[annRuntimeMigrationMounts]
	if raw == "" {
		return nil, nil
	}
	var moved map[string]string
	if err := json.Unmarshal([]byte(raw), &moved); err != nil {
		return nil, fmt.Errorf("the migration's mounts annotation is not a map of paths: %w", err)
	}
	var links []runtimeMigrationLink
	for old, to := range moved {
		if old == agentHomeDir || strings.HasPrefix(old, agentHomeDir+"/") {
			continue
		}
		at, ok := strings.CutPrefix(to, agentHomeDir+"/")
		if !ok || at == "" {
			return nil, fmt.Errorf("the migration moves %s to %s, which is not inside %s", old, to, agentHomeDir)
		}
		links = append(links, runtimeMigrationLink{Path: old, At: at})
	}
	sort.Slice(links, func(i, j int) bool { return links[i].Path < links[j].Path })
	return links, nil
}

func recordedGrafts(agent *apiv1.Agent) ([]runtimeMigrationGraft, error) {
	raw := agent.Annotations[annRuntimeMigrationGrafts]
	if raw == "" {
		return nil, nil
	}
	var grafts []runtimeMigrationGraft
	if err := json.Unmarshal([]byte(raw), &grafts); err != nil {
		return nil, fmt.Errorf("the recorded volumes to carry are not readable: %w", err)
	}
	return grafts, nil
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
		grafts, err := recordedGrafts(agent)
		if err != nil {
			return r.noteRuntimeMigration(ctx, name, err)
		}
		links, err := runtimeMigrationLinks(agent)
		if err != nil {
			return r.noteRuntimeMigration(ctx, name, err)
		}
		desired, err := r.buildRuntimeMigrationJob(agent, owner, source, grafts, links)
		if err != nil {
			return err
		}
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
	grafts, err := recordedGrafts(agent)
	if err != nil {
		return err
	}
	if source := agent.Annotations[annRuntimeMigrationSource]; source != "" {
		grafts = append([]runtimeMigrationGraft{{From: agentHomeDir, PVC: source}}, grafts...)
	}
	for _, g := range grafts {
		if err := r.retainMigratedVolume(ctx, agent, g.PVC, g.From, until); err != nil {
			return err
		}
	}
	slog.Info("runtime migration: agent moved to the vm backend", "agent", name)
	return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigration:        nil,
		annRuntimeMigrationMessage: nil,
		annRuntimeMigrationSource:  nil,
		annRuntimeMigrationMounts:  nil,
		annRuntimeMigrationGrafts:  nil,
	})
}

// UNIT_BOUNDARY_DESCRIPTION: what the user is shown while a migration is stuck. The phase stays where it is and the step is retried, so the message is advice about the present, cleared as soon as the step it describes gets past it.
func (r *AgentReconciler) noteRuntimeMigration(ctx context.Context, name string, cause error) error {
	msg := cause.Error()
	slog.Warn("runtime migration: step not done", "agent", name, "reason", msg)
	return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{annRuntimeMigrationMessage: new(msg)})
}

// UNIT_BOUNDARY_DESCRIPTION: the Job reads the old volumes read-only as root — the home and every other persisted volume the migration carries, each grafted into the seed where the rewritten spec put it below HOME, with the boot hook that links each moved path back — HOME holds files owned by the agent's user with private modes, and the tar has to carry them exactly — and reaches only the owner's runner, with the runner's token and the CA that signed its serving certificate. It runs where the agent's pods run, since that is where its volumes attach.
func (r *AgentReconciler) buildRuntimeMigrationJob(agent *apiv1.Agent, owner, source string, grafts []runtimeMigrationGraft, links []runtimeMigrationLink) (*batchv1.Job, error) {
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
	command := []string{
		runtimeMigrationSeedBinary,
		"--source", runtimeMigrationSourcePath,
		"--url", url,
		"--token-file", runtimeMigrationCredsPath + "/token",
		"--ca-file", runtimeMigrationCredsPath + "/ca.crt",
		"--map-owner", runtimeMigrationOwnerMap(cfg),
	}
	mounts := []corev1.VolumeMount{
		{Name: "home", MountPath: runtimeMigrationSourcePath, ReadOnly: true},
		{Name: "credentials", MountPath: runtimeMigrationCredsPath, ReadOnly: true},
	}
	volumes := []corev1.Volume{
		{Name: "home", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: source, ReadOnly: true}}},
		{Name: "credentials", VolumeSource: corev1.VolumeSource{Projected: &corev1.ProjectedVolumeSource{
			DefaultMode: new(int32(0o400)),
			Sources: []corev1.VolumeProjection{
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerName(owner)}, Items: []corev1.KeyToPath{{Key: "token", Path: "token"}}}},
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerTLSName(owner)}, Items: []corev1.KeyToPath{{Key: "ca.crt", Path: "ca.crt"}}}},
			},
		}}},
	}
	if len(links) > 0 {
		encoded, err := json.Marshal(links)
		if err != nil {
			return nil, err
		}
		command = append(command, "--links", string(encoded))
	}
	for i, g := range grafts {
		volume := "extra-" + strconv.Itoa(i)
		path := runtimeMigrationExtraPath + "/" + strconv.Itoa(i)
		command = append(command, "--graft", g.At+"="+path)
		mounts = append(mounts, corev1.VolumeMount{Name: volume, MountPath: path, ReadOnly: true})
		volumes = append(volumes, corev1.Volume{Name: volume, VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: g.PVC, ReadOnly: true}}})
	}
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
						Command:                  command,
						VolumeMounts:             mounts,
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
					Volumes: volumes,
				},
			},
		},
	}
	applyAgentBaseScheduling(&job.Spec.Template.Spec, cfg.AgentBase)
	job.Spec.Template.Spec.RuntimeClassName = nil
	return job, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the container ran the agent as the install's agent uid and gid, and a machine's harness runs as root, so the seed maps that uid and gid to root. The ids come from the same security context the agent's pods and the storage migration read, with the same fallback.
func runtimeMigrationOwnerMap(cfg *config.Config) string {
	uid, gid := migrationFallbackUID, migrationFallbackGID
	if sc := cfg.AgentBase.ContainerSecurityContext; sc != nil {
		if sc.RunAsUser != nil {
			uid = *sc.RunAsUser
		}
		if sc.RunAsGroup != nil {
			gid = *sc.RunAsGroup
		}
	}
	return fmt.Sprintf("%d:%d:0", uid, gid)
}
