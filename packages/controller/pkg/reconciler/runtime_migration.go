package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: moving an Agent from the container Backend to the vm one. The api-server is the one spec writer, so it flips the Backend and stamps the request in one patch; everything after is the controller's, and each phase is derived from cluster state so a restart resumes where it left off. `requested` takes the old pod down and records which volume holds HOME and which holds each other persisted path the api-server moved below it; `copying` creates the machine stopped and runs a Job that streams those volumes, as one tree, to the owner's runner, where it waits as the machine's seed; `booting` lets the machine start, and platform-init seeds the fresh disk from it rather than from the image. The old volume is released only once the machine has answered, so a boot that fails still has the agent's work to fall back on, and even then it is retained for a window rather than deleted.
const (
	annRuntimeMigration        = "agent-platform.ai/runtime-migration"
	annRuntimeMigrationMessage = "agent-platform.ai/runtime-migration-message"
	annRuntimeMigrationSource  = "agent-platform.ai/runtime-migration-source"
	annRuntimeMigrationMounts  = "agent-platform.ai/runtime-migration-mounts"
	annRuntimeMigrationGrafts  = "agent-platform.ai/runtime-migration-grafts"
	annRuntimeMigrationSeed    = "agent-platform.ai/runtime-migration-seed"

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

// UNIT_BOUNDARY_DESCRIPTION: until the seed is on the runner, nothing may run: the old pod would keep writing to a volume that is being copied, and a machine that booted would seed its disk from the image and never look at the copy again. A boot is let through only with the seed it must come from recorded, since that is what the runner and platform-init hold the boot to.
func runtimeMigrationHoldsDown(annotations map[string]string) bool {
	switch annotations[annRuntimeMigration] {
	case "":
		return false
	case runtimeMigrationBooting:
		_, err := runtimeMigrationSeed(annotations)
		return err != nil
	default:
		return true
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the seed a booting migration expects the machine's home to come from, as vm-seed verified the runner's answer to its upload. It is recorded when the copy Job completes and sent to the runner in the machine's spec for as long as the migration boots.
func runtimeMigrationSeed(annotations map[string]string) (vmrunner.SeedResult, error) {
	var seed vmrunner.SeedResult
	raw := annotations[annRuntimeMigrationSeed]
	if raw == "" {
		return seed, errors.New("the seed the machine must boot from was not recorded")
	}
	if err := json.Unmarshal([]byte(raw), &seed); err != nil {
		return seed, fmt.Errorf("the recorded seed is not readable: %w", err)
	}
	return seed, validSeed(seed)
}

func validSeed(seed vmrunner.SeedResult) error {
	if seed.Bytes == 0 || len(seed.SHA256) != 64 || strings.Trim(seed.SHA256, "0123456789abcdef") != "" {
		return fmt.Errorf("%d bytes with SHA-256 %q is not a seed", seed.Bytes, seed.SHA256)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: what the machine's spec says about the seed: the one a booting migration expects, and nothing otherwise, so a machine whose migration ended boots whatever home its disk holds.
func runtimeMigrationExpectSeed(agent *apiv1.Agent) *vmrunner.SeedResult {
	if agent.Annotations[annRuntimeMigration] != runtimeMigrationBooting {
		return nil
	}
	seed, err := runtimeMigrationSeed(agent.Annotations)
	if err != nil {
		return nil
	}
	return &seed
}

func runtimeMigrationJobName(agentName string) string {
	name := "rtm-" + agentName
	if len(name) > 63 {
		name = name[:63]
	}
	return name
}

// UNIT_BOUNDARY_DESCRIPTION: what one phase step found, handed on to the step after the machine is ensured. `note` is what the user should be told about the present; `moved` says the step already patched the Agent into another phase, so nothing later in the same reconcile writes a message derived from the phase it left.
type runtimeMigrationStep struct {
	note  string
	moved bool
}

// UNIT_BOUNDARY_DESCRIPTION: the `requested` phase, run before the machine is ensured. It is idempotent: the source volumes are recorded once, while the old StatefulSet still names them, and the headless Service a pod needed is removed so the vm reconcile creates the ClusterIP one a machine needs. It moves on only once the old pod is gone. An Agent that never had a volume at all — created and never woken — has nothing to copy, which is only provable once its StatefulSet is gone and nothing can make one any more. There is then no seed to hold a boot to, so the migration ends at once, said in an Event, and the machine starts from the image when the Agent next runs, as a new vm Agent's does. A pod that stays terminating is named with its node, since only someone who can reach that node can end it.
func (r *AgentReconciler) prepareRuntimeMigration(ctx context.Context, agent *apiv1.Agent) (runtimeMigrationStep, error) {
	name := agent.Name
	if agent.Annotations[annRuntimeMigration] != runtimeMigrationRequested {
		return runtimeMigrationStep{}, nil
	}
	patch := map[string]*string{}
	source := agent.Annotations[annRuntimeMigrationSource]
	if source == "" {
		found, err := r.runtimeMigrationVolume(ctx, agent, agentHomeDir)
		if err != nil {
			return runtimeMigrationStep{note: err.Error()}, nil
		}
		if found != "" {
			grafts, err := r.runtimeMigrationGrafts(ctx, agent)
			if err != nil {
				return runtimeMigrationStep{note: err.Error()}, nil
			}
			source = found
			patch[annRuntimeMigrationSource] = new(source)
			if len(grafts) > 0 {
				encoded, err := json.Marshal(grafts)
				if err != nil {
					return runtimeMigrationStep{}, err
				}
				patch[annRuntimeMigrationGrafts] = new(string(encoded))
			}
		}
	}
	ns := r.config.Namespace
	if err := r.client.AppsV1().StatefulSets(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
		return runtimeMigrationStep{}, fmt.Errorf("deleting the container statefulset: %w", err)
	}
	svc, err := r.client.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
	if err == nil && svc.Spec.ClusterIP == corev1.ClusterIPNone {
		if err := r.client.CoreV1().Services(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
			return runtimeMigrationStep{}, fmt.Errorf("deleting the headless agent service: %w", err)
		}
	} else if err != nil && !k8serrors.IsNotFound(err) {
		return runtimeMigrationStep{}, err
	}
	pods, err := r.client.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + name + "," + LabelRole + "=" + RoleAgent,
	})
	if err != nil {
		return runtimeMigrationStep{}, err
	}
	var step runtimeMigrationStep
	switch {
	case len(pods.Items) > 0:
		step.note = stuckTerminating(pods.Items, time.Now())
	case source != "":
		patch[annRuntimeMigration] = new(runtimeMigrationCopying)
		step.moved = true
		slog.Info("runtime migration: container pod gone, copying home", "agent", name)
		r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigrationCopying", "the old pod is gone; the agent's volumes are copied to its new machine next")
	default:
		empty, why, err := r.runtimeMigrationHasNothingToCopy(ctx, agent)
		if err != nil {
			return runtimeMigrationStep{}, err
		}
		if !empty {
			step.note = why
			break
		}
		for _, key := range []string{annRuntimeMigration, annRuntimeMigrationMessage, annRuntimeMigrationSource, annRuntimeMigrationMounts, annRuntimeMigrationGrafts, annRuntimeMigrationSeed} {
			patch[key] = nil
		}
		step.moved = true
		slog.Info("runtime migration: nothing to copy, the agent runs on the vm backend from the image", "agent", name)
		r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigrationFinished", why)
	}
	if len(patch) == 0 {
		return step, nil
	}
	return step, patchAgentAnnotations(ctx, r.dynamic, ns, name, patch)
}

// UNIT_BOUNDARY_DESCRIPTION: how long the old pod may take to terminate before the user is told which pod and node it is stuck on. A pod whose node stopped answering is never confirmed gone by its kubelet, and the migration cannot copy a volume that may still be written to.
const runtimeMigrationTerminatingGrace = 3 * time.Minute

func stuckTerminating(pods []corev1.Pod, now time.Time) string {
	for _, p := range pods {
		if p.DeletionTimestamp == nil || now.Sub(p.DeletionTimestamp.Time) < runtimeMigrationTerminatingGrace {
			continue
		}
		node := p.Spec.NodeName
		if node == "" {
			node = "(none)"
		}
		return fmt.Sprintf("waiting for the old pod %s on node %s, terminating for %s; the copy starts once it is gone, and a node that no longer answers has to be recovered, or the pod force-deleted, by an operator",
			p.Name, node, now.Sub(p.DeletionTimestamp.Time).Round(time.Minute))
	}
	return ""
}

// UNIT_BOUNDARY_DESCRIPTION: whether the Agent provably has nothing to copy: its StatefulSet is gone, so nothing will make a volume for it any more, and no volume is labelled for it, not even one mid-way through a storage migration. A path moved from outside HOME needs no seed either: its link is in the machine's links plan, from the Agent's spec, and platform-init makes it on every boot.
func (r *AgentReconciler) runtimeMigrationHasNothingToCopy(ctx context.Context, agent *apiv1.Agent) (bool, string, error) {
	name := agent.Name
	ns := r.config.Namespace
	if _, err := r.client.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{}); err == nil {
		return false, "waiting for the old container statefulset to be removed", nil
	} else if !k8serrors.IsNotFound(err) {
		return false, "", err
	}
	for _, selector := range []string{LabelAgent + "=" + name, LabelMigrationFor + "=" + name} {
		list, err := r.client.CoreV1().PersistentVolumeClaims(ns).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			return false, "", err
		}
		if len(list.Items) > 0 {
			return false, fmt.Sprintf("no volume holds this agent's home (%s), but %s is labelled for it, so there is no telling what to copy", agentHomeDir, list.Items[0].Name), nil
		}
	}
	return true, runtimeMigrationNothingToCopy, nil
}

const runtimeMigrationNothingToCopy = "this agent never had a volume, so there was nothing to copy; its machine starts from the image"

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

// UNIT_BOUNDARY_DESCRIPTION: the `copying` and `booting` phases, run after the machine is ensured, since both read what the runner said about it. A copy waits for the machine to exist and be stopped — the runner refuses a seed otherwise — and on success moves to `booting` with a fresh activity stamp and the seed the runner stored, so the machine boots once even for an agent that was asleep: the copy is only proven by a guest that seeded from it. `booting` ends when the guest answers and the runner reports that its home came from exactly that seed; the seed is removed then, and not before, and the old volume is retained for its window. A seed the runner no longer holds, or a guest whose home came from anything else, sends the migration back to copying instead. Whatever else holds the migration up in any phase — the step's own finding, then a runner that is not ready or a machine the runner could not make — is written as its message on every reconcile, so the message always says what is true now.
func (r *AgentReconciler) continueRuntimeMigration(ctx context.Context, agent *apiv1.Agent, machine vmrunner.MachineStatus, runnerReached bool, prior runtimeMigrationStep) error {
	phase := agent.Annotations[annRuntimeMigration]
	if phase == "" || prior.moved {
		return nil
	}
	step := prior
	if runnerReached {
		var err error
		switch phase {
		case runtimeMigrationCopying:
			if machine.State == vmrunner.StateStopped {
				step, err = r.runRuntimeMigrationCopy(ctx, agent)
			}
		case runtimeMigrationBooting:
			expected, invalid := runtimeMigrationSeed(agent.Annotations)
			if invalid != nil {
				return r.copyRuntimeMigrationAgain(ctx, agent, invalid.Error())
			}
			if machine.Reason == vmrunner.ReasonSeedMissing {
				return r.copyRuntimeMigrationAgain(ctx, agent, "the runner does not hold the copied home: "+machine.Message)
			}
			if machine.Ready {
				if machine.HomeSeededFrom != expected.SHA256 {
					from := "the image"
					if machine.HomeSeededFrom != "" {
						from = "seed " + machine.HomeSeededFrom
					}
					return r.copyRuntimeMigrationAgain(ctx, agent, fmt.Sprintf("the new machine answered with a home from %s, not from the copy (seed %s)", from, expected.SHA256))
				}
				return r.finishRuntimeMigration(ctx, agent)
			}
		}
		if err != nil || step.moved {
			return err
		}
	}
	note := step.note
	if note == "" {
		note = vmSideProblem(machine, runnerReached)
	}
	return r.setRuntimeMigrationMessage(ctx, agent, note)
}

// UNIT_BOUNDARY_DESCRIPTION: what the runner says is keeping the machine from the migration's next step: a runner that is not ready, with the reason the controller found for it, or a machine it failed to create, start or admit. A machine that is merely on its way says nothing.
func vmSideProblem(machine vmrunner.MachineStatus, runnerReached bool) string {
	if !runnerReached {
		msg := machine.Message
		if msg == "" {
			msg = machine.Reason
		}
		return msg
	}
	if machine.Reason == "" || machine.Reason == vmrunner.ReasonNotReady {
		return ""
	}
	msg := machine.Message
	if msg == "" {
		msg = machine.Reason
	}
	return fmt.Sprintf("the new machine is %s: %s", machine.State, msg)
}

// UNIT_BOUNDARY_DESCRIPTION: what makes an Agent in `booting` stay down before its first answer, said on the Agent: a stop the user asked for, which is honoured and resumed from on the next start, or an owner budget with no room for the machine.
func runtimeMigrationBootHeld(annotations map[string]string, hardStop bool, overBudget string) string {
	if annotations[annRuntimeMigration] != runtimeMigrationBooting {
		return ""
	}
	switch {
	case hardStop:
		return "the agent was stopped before its new machine first answered; the move finishes when it next starts"
	case overBudget != "":
		return "the new machine is waiting for room in the owner's budget to boot: " + overBudget
	}
	return ""
}

func (r *AgentReconciler) runRuntimeMigrationCopy(ctx context.Context, agent *apiv1.Agent) (runtimeMigrationStep, error) {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	source := agent.Annotations[annRuntimeMigrationSource]
	if source == "" {
		return runtimeMigrationStep{moved: true}, patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{annRuntimeMigration: new(runtimeMigrationRequested)})
	}
	jobs := r.client.BatchV1().Jobs(r.config.Namespace)
	prop := metav1.DeletePropagationBackground
	job, err := jobs.Get(ctx, runtimeMigrationJobName(name), metav1.GetOptions{})
	if err == nil && !ownedBy(job, agent) {
		slog.Warn("runtime migration: removing a copy job another agent of this name left", "agent", name, "job", job.Name)
		if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
			return runtimeMigrationStep{}, fmt.Errorf("deleting a stale home copy job: %w", err)
		}
		return runtimeMigrationStep{note: "a copy job left by an earlier agent of the same name was removed; the copy starts again"}, nil
	}
	if k8serrors.IsNotFound(err) {
		return r.startRuntimeMigrationCopy(ctx, agent, owner, source)
	}
	if err != nil {
		return runtimeMigrationStep{}, err
	}
	if job.DeletionTimestamp != nil {
		return runtimeMigrationStep{}, nil
	}
	switch {
	case jobConditionTrue(job, batchv1.JobComplete):
		seed, why, err := r.copyJobSeed(ctx, job)
		if err != nil {
			return runtimeMigrationStep{}, err
		}
		if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
			return runtimeMigrationStep{}, fmt.Errorf("deleting the home copy job: %w", err)
		}
		if err := r.deleteRuntimeMigrationNetworkPolicy(ctx, name); err != nil {
			return runtimeMigrationStep{}, err
		}
		if why != "" {
			msg := fmt.Sprintf("the home was copied, but %s; copying it again", why)
			r.migrationEvent(ctx, agent, corev1.EventTypeWarning, "RuntimeMigrationCopyFailed", msg)
			return runtimeMigrationStep{note: msg}, nil
		}
		encoded, err := json.Marshal(seed)
		if err != nil {
			return runtimeMigrationStep{}, err
		}
		slog.Info("runtime migration: home copied, booting the machine", "agent", name, "seedBytes", seed.Bytes, "seedSHA256", seed.SHA256)
		r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigrationBooting", "the agent's volumes are on its new machine, which now boots from them")
		return runtimeMigrationStep{moved: true}, patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
			annRuntimeMigration:        new(runtimeMigrationBooting),
			annRuntimeMigrationSeed:    new(string(encoded)),
			annRuntimeMigrationMessage: nil,
			annLastActivity:            new(time.Now().UTC().Format(time.RFC3339)),
		})
	case jobConditionTrue(job, batchv1.JobFailed):
		reason := "copying the home directory failed; retrying"
		if why := r.copyJobFailure(ctx, job); why != "" {
			reason = fmt.Sprintf("copying the home directory failed (%s); retrying", why)
			if job.Annotations[annRuntimeMigrationMixedReader] == "true" && permissionDenied(why) {
				reason = fmt.Sprintf("copying the home directory failed: %s (%s); retrying", runtimeMigrationMixedHint, why)
			}
		}
		if r.sanitizeFor(agent, reason) != agent.Annotations[annRuntimeMigrationMessage] {
			r.migrationEvent(ctx, agent, corev1.EventTypeWarning, "RuntimeMigrationCopyFailed", reason)
		}
		if time.Since(job.CreationTimestamp.Time) >= migrationJobRetryAfter {
			slog.Warn("runtime migration: deleting failed home copy job for retry", "agent", name, "job", job.Name)
			if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
				return runtimeMigrationStep{}, err
			}
		}
		return runtimeMigrationStep{note: reason}, nil
	}
	return runtimeMigrationStep{note: r.copyPodWaiting(ctx, job)}, nil
}

// UNIT_BOUNDARY_DESCRIPTION: a copy Job is created only once there is a slot for it, its NetworkPolicy is in place and the runner's Service has an address to pin in the pod. The slot count and the create run under one lock, so two reconciles cannot both take the last slot.
func (r *AgentReconciler) startRuntimeMigrationCopy(ctx context.Context, agent *apiv1.Agent, owner, source string) (runtimeMigrationStep, error) {
	name := agent.Name
	if err := ensureMigrationServiceAccount(ctx, r.client, r.config.Namespace); err != nil {
		return runtimeMigrationStep{}, err
	}
	grafts, err := recordedGrafts(agent)
	if err != nil {
		return runtimeMigrationStep{note: err.Error()}, nil
	}
	runnerIP, err := r.runnerPodIP(ctx, owner)
	if err != nil {
		return runtimeMigrationStep{}, err
	}
	if runnerIP == "" {
		return runtimeMigrationStep{note: "waiting for the owner's VM runner pod to be ready"}, nil
	}
	if err := applyNetworkPolicy(ctx, r.client, buildRuntimeMigrationNetworkPolicy(agent, owner, r.config.Namespace)); err != nil {
		return runtimeMigrationStep{}, err
	}
	claims := []string{source}
	for _, g := range grafts {
		claims = append(claims, g.PVC)
	}
	reader, missing, err := r.runtimeMigrationReader(ctx, claims)
	if err != nil {
		return runtimeMigrationStep{}, err
	}
	if missing != "" {
		return runtimeMigrationStep{note: fmt.Sprintf("the volume %s this migration copies from no longer exists", missing)}, nil
	}
	desired, err := r.buildRuntimeMigrationJob(agent, owner, source, runnerIP, reader, grafts)
	if err != nil {
		return runtimeMigrationStep{}, err
	}
	r.migrationCopyMu.Lock()
	defer r.migrationCopyMu.Unlock()
	if wait, err := r.runtimeMigrationCopySlot(ctx, owner); err != nil || wait != "" {
		return runtimeMigrationStep{note: wait}, err
	}
	if _, err := r.client.BatchV1().Jobs(r.config.Namespace).Create(ctx, desired, metav1.CreateOptions{}); err != nil && !k8serrors.IsAlreadyExists(err) {
		return runtimeMigrationStep{}, fmt.Errorf("creating the home copy job: %w", err)
	}
	slog.Info("runtime migration: home copy started", "agent", name, "pvc", source)
	return runtimeMigrationStep{}, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the address the copy Job reaches the runner at. The runner's Service is headless, so its name resolves to this very pod address; writing it into the Job's hosts file under the Service's name keeps the name the runner's certificate is issued for while the Job needs no resolver. A runner pod replaced mid-copy fails the upload either way, and the retry pins the new pod.
func (r *AgentReconciler) runnerPodIP(ctx context.Context, owner string) (string, error) {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: labels.Set(vmRunnerSelector(owner)).String()})
	if err != nil {
		return "", fmt.Errorf("finding the owner's VM runner pod: %w", err)
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.DeletionTimestamp == nil && pod.Status.PodIP != "" && isPodReady(*pod) {
			return pod.Status.PodIP, nil
		}
	}
	return "", nil
}

const (
	defaultRuntimeMigrationConcurrency      = 10
	defaultRuntimeMigrationOwnerConcurrency = 1
)

// UNIT_BOUNDARY_DESCRIPTION: how many copy Jobs may run at once, in the install and for one owner. Each copy reads whole volumes and writes one owner's runner claim, so the install cap bounds the load on storage and the owner cap the load on a runner whose claim also holds that owner's running machines. A Job that has finished, either way, holds no slot.
func (r *AgentReconciler) runtimeMigrationCopySlot(ctx context.Context, owner string) (string, error) {
	fleetCap := r.config.VM.RuntimeMigration.Concurrency
	if fleetCap <= 0 {
		fleetCap = defaultRuntimeMigrationConcurrency
	}
	ownerCap := r.config.VM.RuntimeMigration.OwnerConcurrency
	if ownerCap <= 0 {
		ownerCap = defaultRuntimeMigrationOwnerConcurrency
	}
	list, err := r.client.BatchV1().Jobs(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: LabelRole + "=" + RoleRuntimeMigration})
	if err != nil {
		return "", fmt.Errorf("counting running home copies: %w", err)
	}
	fleet, mine := 0, 0
	for i := range list.Items {
		job := &list.Items[i]
		if jobConditionTrue(job, batchv1.JobComplete) || jobConditionTrue(job, batchv1.JobFailed) {
			continue
		}
		fleet++
		if job.Labels[envoyOwnerLabel] == owner {
			mine++
		}
	}
	switch {
	case mine >= ownerCap:
		return fmt.Sprintf("waiting to copy: %d of this owner's migrations are copying, the most allowed at once", mine), nil
	case fleet >= fleetCap:
		return fmt.Sprintf("waiting to copy: %d migrations are copying in this install, the most allowed at once", fleet), nil
	}
	return "", nil
}

// UNIT_BOUNDARY_DESCRIPTION: the advice for a mixed set whose share refused root. It comes before vm-seed's own error in the message, because the message is cut to a status line's length and a path in that error can be as long as the agent made it.
const runtimeMigrationMixedHint = "this agent has both shared and block volumes, which one copy reads as root, and a share that squashes root refuses it; moving the shared volume to block storage first lets the copy finish"

func permissionDenied(why string) bool {
	return strings.Contains(why, "Permission denied") || strings.Contains(why, "os error 13")
}

func ownedBy(obj metav1.Object, agent *apiv1.Agent) bool {
	for _, ref := range obj.GetOwnerReferences() {
		if ref.UID == agent.UID && ref.Kind == agentGVK.Kind {
			return true
		}
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: why the copy Job's last attempt failed, in vm-seed's own words: the error it exits with and every cause under it, which the container's termination message carries. A failure that is only ever reported as "failed" cannot be told apart from the next one, and the Job's pods are gone once its time to live runs out. An attempt that never ran — a volume that would not attach, a pod that could not be placed — left no message, so the last warning its pod was given says why instead. Empty when neither is there.
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
		for i := range pods.Items {
			if why := r.warningOn(ctx, pods.Items[i].Namespace, pods.Items[i].Name, pods.Items[i].UID); why != "" {
				return why
			}
		}
		return r.warningOn(ctx, job.Namespace, job.Name, job.UID)
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
	return strings.Join(parts, "; ")
}

// UNIT_BOUNDARY_DESCRIPTION: a copy pod that has not started says why only in its Events: a volume still attached to the old pod's node (Multi-Attach), a mount that fails, a pod the scheduler cannot place. The Job itself reports nothing until its deadline, so the pod's latest warning is shown while it waits.
func (r *AgentReconciler) copyPodWaiting(ctx context.Context, job *batchv1.Job) string {
	pods, err := r.client.CoreV1().Pods(job.Namespace).List(ctx, metav1.ListOptions{LabelSelector: batchv1.JobNameLabel + "=" + job.Name})
	if err != nil {
		return ""
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.Status.Phase != corev1.PodPending {
			continue
		}
		if why := r.warningOn(ctx, pod.Namespace, pod.Name, pod.UID); why != "" {
			return fmt.Sprintf("the copy pod %s is not starting: %s", pod.Name, why)
		}
	}
	if len(pods.Items) == 0 {
		if why := r.warningOn(ctx, job.Namespace, job.Name, job.UID); why != "" {
			return "the copy pod could not be created: " + why
		}
	}
	return ""
}

// UNIT_BOUNDARY_DESCRIPTION: the latest warning Event on one object. A copy pod that cannot start says why only on itself, and one that admission refused — an SCC that does not permit what it asks for — never exists, so the Job's FailedCreate is where that is said.
func (r *AgentReconciler) warningOn(ctx context.Context, namespace, name string, uid k8stypes.UID) string {
	events, err := r.client.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{FieldSelector: "involvedObject.name=" + name})
	if err != nil {
		return ""
	}
	var latest *corev1.Event
	for i := range events.Items {
		e := &events.Items[i]
		if e.InvolvedObject.Name != name || e.InvolvedObject.UID != uid || e.Type != corev1.EventTypeWarning {
			continue
		}
		if latest == nil || eventTime(e).After(eventTime(latest)) {
			latest = e
		}
	}
	if latest == nil {
		return ""
	}
	return latest.Reason + ": " + latest.Message
}

func eventTime(e *corev1.Event) time.Time {
	if !e.LastTimestamp.IsZero() {
		return e.LastTimestamp.Time
	}
	return e.EventTime.Time
}

// UNIT_BOUNDARY_DESCRIPTION: the seed a completed copy Job stored on the runner, as vm-seed wrote it to its termination message once the runner's answer matched what it sent. The pod that succeeded is the one to read. When none is left, or its message is not a seed, the reason says so and the home is copied again, because a boot that is not held to a known seed is exactly the hole the seed contract closes.
func (r *AgentReconciler) copyJobSeed(ctx context.Context, job *batchv1.Job) (vmrunner.SeedResult, string, error) {
	var seed vmrunner.SeedResult
	pods, err := r.client.CoreV1().Pods(job.Namespace).List(ctx, metav1.ListOptions{LabelSelector: batchv1.JobNameLabel + "=" + job.Name})
	if err != nil {
		return seed, "", fmt.Errorf("listing the home copy job's pods: %w", err)
	}
	for i := range pods.Items {
		for _, cs := range pods.Items[i].Status.ContainerStatuses {
			t := cs.State.Terminated
			if t == nil || t.ExitCode != 0 {
				continue
			}
			if err := json.Unmarshal([]byte(t.Message), &seed); err != nil {
				return seed, fmt.Sprintf("the copy's result is not a seed (%v)", err), nil
			}
			if err := validSeed(seed); err != nil {
				return seed, "the copy's result " + err.Error(), nil
			}
			return seed, "", nil
		}
	}
	return seed, "no pod of the copy is left to say which seed it stored", nil
}

// UNIT_BOUNDARY_DESCRIPTION: a boot that cannot prove it came from the copy — the runner lost the seed, or the guest answered with a home from anything else — is not a finished migration. The old volumes still carry their labels, since only a finish retains them, so going back to `copying` is safe. The machine is deleted first, so the new copy lands on a fresh disk that platform-init restores instead of keeping the home already there; the next reconcile creates the machine stopped and copies the home again.
func (r *AgentReconciler) copyRuntimeMigrationAgain(ctx context.Context, agent *apiv1.Agent, why string) error {
	name := agent.Name
	runner, err := r.runnerFor(ctx, agent.Labels[envoyOwnerLabel])
	if err != nil {
		return err
	}
	if err := runner.Delete(ctx, name); err != nil {
		return fmt.Errorf("deleting the machine to copy its home again: %w", err)
	}
	msg := why + "; copying the home again"
	slog.Warn("runtime migration: the boot is not proven to come from the copy", "agent", name, "reason", msg)
	r.migrationEvent(ctx, agent, corev1.EventTypeWarning, "RuntimeMigrationCopyingAgain", msg)
	return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigration:        new(runtimeMigrationCopying),
		annRuntimeMigrationSeed:    nil,
		annRuntimeMigrationMessage: new(r.sanitizeFor(agent, msg)),
	})
}

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
	if err := r.deleteRuntimeMigrationNetworkPolicy(ctx, name); err != nil {
		return err
	}
	slog.Info("runtime migration: agent moved to the vm backend", "agent", name)
	if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigration:        nil,
		annRuntimeMigrationMessage: nil,
		annRuntimeMigrationSource:  nil,
		annRuntimeMigrationMounts:  nil,
		annRuntimeMigrationGrafts:  nil,
		annRuntimeMigrationSeed:    nil,
	}); err != nil {
		return err
	}
	r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigrationFinished", "the new machine answered with the copied home; the agent now runs on the vm backend")
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: what the user is shown while a migration is held up. The phase stays where it is and the step is retried, so the message is advice about the present: it is written only when it changed, and removed when nothing holds the migration up.
func (r *AgentReconciler) setRuntimeMigrationMessage(ctx context.Context, agent *apiv1.Agent, note string) error {
	msg := r.sanitizeFor(agent, note)
	if msg == agent.Annotations[annRuntimeMigrationMessage] {
		return nil
	}
	var value *string
	if msg != "" {
		slog.Warn("runtime migration: step not done", "agent", agent.Name, "reason", msg)
		value = new(msg)
	}
	return patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, agent.Name, map[string]*string{annRuntimeMigrationMessage: value})
}

func (r *AgentReconciler) sanitizeFor(agent *apiv1.Agent, msg string) string {
	host := ""
	if owner := agent.Labels[envoyOwnerLabel]; owner != "" {
		host = r.runnerHost(owner)
	}
	return sanitizeMigrationMessage(msg, host)
}

const runtimeMigrationMessageMax = 300

var (
	migrationURLPattern  = regexp.MustCompile(`https?://[^\s()"';,]+`)
	migrationAddrPattern = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b`)
)

// UNIT_BOUNDARY_DESCRIPTION: a migration message is shown to the user and partly written by what the copy read: vm-seed's error names the files it failed on, and those names are the agent's own, so a crafted one could carry terminal escapes or text-direction overrides. Every control and formatting character is escaped rather than rendered, invalid UTF-8 is replaced, the runner's in-cluster address — its URL, host or any IP — becomes a fixed phrase, and the whole is cut to a length a status line can hold.
func sanitizeMigrationMessage(msg, runnerHost string) string {
	const runnerPhrase = "the owner's VM runner"
	msg = strings.ToValidUTF8(msg, "\uFFFD")
	if runnerHost != "" {
		msg = migrationURLPattern.ReplaceAllStringFunc(msg, func(u string) string {
			if strings.Contains(u, runnerHost) {
				return runnerPhrase
			}
			return u
		})
		msg = regexp.MustCompile(regexp.QuoteMeta(runnerHost)+`(?::\d+)?`).ReplaceAllString(msg, runnerPhrase)
	}
	msg = migrationAddrPattern.ReplaceAllString(msg, "an in-cluster address")
	var b strings.Builder
	for _, c := range msg {
		switch {
		case c == '\n' || c == '\t':
			b.WriteByte(' ')
		case unicode.IsControl(c) || unicode.Is(unicode.Cf, c):
			fmt.Fprintf(&b, "\\u%04x", c)
		default:
			b.WriteRune(c)
		}
	}
	out := strings.TrimSpace(b.String())
	if runes := []rune(out); len(runes) > runtimeMigrationMessageMax {
		out = string(runes[:runtimeMigrationMessageMax]) + "…"
	}
	return out
}

// UNIT_BOUNDARY_DESCRIPTION: each migration step the controller takes is also an Event on the Agent, and counted, so an operator can follow a migration in `kubectl get events` and across the fleet without reading annotations. An Event that cannot be written is logged and never fails the step.
func (r *AgentReconciler) migrationEvent(ctx context.Context, agent *apiv1.Agent, eventType, reason, message string) {
	telemetry.RuntimeMigrationEvent(ctx, reason)
	now := metav1.Now()
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s.%x", agent.Name, now.UnixNano()), Namespace: r.config.Namespace},
		InvolvedObject: corev1.ObjectReference{
			APIVersion: agentGVK.GroupVersion().String(),
			Kind:       agentGVK.Kind,
			Name:       agent.Name,
			Namespace:  r.config.Namespace,
			UID:        agent.UID,
		},
		Reason:         reason,
		Message:        r.sanitizeFor(agent, message),
		Type:           eventType,
		Source:         corev1.EventSource{Component: "platform-controller"},
		FirstTimestamp: now,
		LastTimestamp:  now,
		Count:          1,
	}
	if _, err := r.client.CoreV1().Events(r.config.Namespace).Create(ctx, event, metav1.CreateOptions{}); err != nil {
		slog.Warn("runtime migration: writing an event on the agent failed", "agent", agent.Name, "reason", reason, "error", err)
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the copy Job's own NetworkPolicy. The pod admits nothing in and reaches one place: the machine API port of its owner's runner pods. It needs no DNS — the Job's pod carries the runner pod's address in its hosts file — and nothing else, since the chart's deny-all egress baseline selects agent pods only. It is owned by the Agent and removed once the copy has landed.
func buildRuntimeMigrationNetworkPolicy(agent *apiv1.Agent, owner, ns string) *networkingv1.NetworkPolicy {
	tcp := corev1.ProtocolTCP
	api := intstr.FromInt(vmRunnerPort)
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:            runtimeMigrationJobName(agent.Name),
			Namespace:       ns,
			OwnerReferences: []metav1.OwnerReference{agentOwnerRef(agent)},
			Labels: map[string]string{
				LabelMigrationFor:              agent.Name,
				"agent-platform.ai/managed-by": "platform-controller",
			},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: runtimeMigrationPodSelector(agent.Name, owner)},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress},
			Egress: []networkingv1.NetworkPolicyEgressRule{{
				To:    []networkingv1.NetworkPolicyPeer{{PodSelector: &metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)}}},
				Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &api}},
			}},
		},
	}
}

func runtimeMigrationPodSelector(agentName, owner string) map[string]string {
	return map[string]string{
		LabelMigrationFor: agentName,
		LabelRole:         RoleRuntimeMigration,
		envoyOwnerLabel:   owner,
	}
}

func (r *AgentReconciler) deleteRuntimeMigrationNetworkPolicy(ctx context.Context, agentName string) error {
	err := r.client.NetworkingV1().NetworkPolicies(r.config.Namespace).Delete(ctx, runtimeMigrationJobName(agentName), metav1.DeleteOptions{})
	if err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("deleting the home copy network policy: %w", err)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: which identity the copy reads its volumes as. A shared volume — one that admits more than one node — may be a share that squashes root, where uid 0 is the weakest identity on the mount and gets EACCES on the agent's own 0600 files, so a copy of shared volumes alone reads as the agent's uid, with no capability at all. A volume only one node mounts is a block device that squashes nothing, and its filesystem root holds a root-owned 0700 lost+found the archive walks, which the agent's uid cannot open; a copy with any such volume reads as root holding DAC_READ_SEARCH alone, which reads every file and directory and writes nothing. One process reads every volume, so a mixed set takes root, which reads the block volume for certain; a shared volume beside it that squashes root then fails with EACCES, and `mixed` lets that failure be explained.
type runtimeMigrationIdentity struct {
	uid, gid int64
	caps     []corev1.Capability
	mixed    bool
}

const annRuntimeMigrationMixedReader = "agent-platform.ai/runtime-migration-mixed-reader"

func (r *AgentReconciler) runtimeMigrationReader(ctx context.Context, claims []string) (runtimeMigrationIdentity, string, error) {
	uid, gid := migrationAgentIdentity(r.config)
	agent := runtimeMigrationIdentity{uid: uid, gid: gid}
	shared, block := false, false
	for _, name := range claims {
		pvc, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			return runtimeMigrationIdentity{}, name, nil
		}
		if err != nil {
			return runtimeMigrationIdentity{}, "", fmt.Errorf("reading the volume %s to copy: %w", name, err)
		}
		if slices.ContainsFunc(pvc.Spec.AccessModes, func(m corev1.PersistentVolumeAccessMode) bool {
			return m == corev1.ReadWriteMany || m == corev1.ReadOnlyMany
		}) {
			shared = true
		} else {
			block = true
		}
	}
	if !block {
		return agent, "", nil
	}
	return runtimeMigrationIdentity{uid: 0, gid: 0, caps: []corev1.Capability{"DAC_READ_SEARCH"}, mixed: shared}, "", nil
}

// UNIT_BOUNDARY_DESCRIPTION: the uid and gid that own an agent's files on the container backend, which every copy reads its source as. On a root-squashing share uid 0 is the weakest identity on the mount, while the agent's uid reads everything the agent wrote.
func migrationAgentIdentity(cfg *config.Config) (int64, int64) {
	uid, gid := migrationFallbackUID, migrationFallbackGID
	if sc := cfg.AgentBase.ContainerSecurityContext; sc != nil {
		if sc.RunAsUser != nil {
			uid = *sc.RunAsUser
		}
		if sc.RunAsGroup != nil {
			gid = *sc.RunAsGroup
		}
	}
	return uid, gid
}

// UNIT_BOUNDARY_DESCRIPTION: the seed sits on the owner's runner claim from the moment the copy starts until the guest has booted from it, beside the disk it is restored into, so the claim needs room for both at once. The seed is never larger than the volumes it was read from, so their requested size bounds it.
func (r *AgentReconciler) runtimeMigrationSeedBytes(ctx context.Context, agent *apiv1.Agent) int64 {
	switch agent.Annotations[annRuntimeMigration] {
	case runtimeMigrationCopying, runtimeMigrationBooting:
	default:
		return 0
	}
	source := agent.Annotations[annRuntimeMigrationSource]
	if source == "" {
		return 0
	}
	claims := []string{source}
	if grafts, err := recordedGrafts(agent); err == nil {
		for _, g := range grafts {
			claims = append(claims, g.PVC)
		}
	}
	var total int64
	for _, name := range claims {
		pvc, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			continue
		}
		size := pvc.Spec.Resources.Requests[corev1.ResourceStorage]
		total += size.Value()
	}
	return total
}

// UNIT_BOUNDARY_DESCRIPTION: the Job reads the old volumes read-only — the home and every other persisted volume the migration carries, each grafted into the seed where the rewritten spec put it below HOME — as the identity the volumes call for. It runs confined: the runtime's default seccomp profile, no capability beyond the one reading may need, no privilege escalation and a read-only root, under the agent pods' own RuntimeClass, since it only reads. It reaches only the owner's runner, pinned by the runner pod's address in its hosts file so it needs no DNS, with the runner's token and the CA that signed its serving certificate. It runs where the agent's pods run, since that is where its volumes attach.
func (r *AgentReconciler) buildRuntimeMigrationJob(agent *apiv1.Agent, owner, source, runnerIP string, reader runtimeMigrationIdentity, grafts []runtimeMigrationGraft) (*batchv1.Job, error) {
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
	uid, gid := reader.uid, reader.gid
	nonRoot := uid != 0
	seccomp := &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}
	url := fmt.Sprintf("https://%s:%d/machines/%s/seed", r.runnerHost(owner), vmRunnerPort, name)
	command := []string{
		runtimeMigrationSeedBinary,
		"--source", runtimeMigrationSourcePath,
		"--url", url,
		"--token-file", runtimeMigrationCredsPath + "/token",
		"--ca-file", runtimeMigrationCredsPath + "/ca.crt",
		"--result-file", corev1.TerminationMessagePathDefault,
		"--map-owner", runtimeMigrationOwnerMap(cfg),
	}
	mounts := []corev1.VolumeMount{
		{Name: "home", MountPath: runtimeMigrationSourcePath, ReadOnly: true},
		{Name: "credentials", MountPath: runtimeMigrationCredsPath, ReadOnly: true},
		{Name: "tmp", MountPath: "/tmp"},
	}
	volumes := []corev1.Volume{
		{Name: "home", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: source, ReadOnly: true}}},
		{Name: "credentials", VolumeSource: corev1.VolumeSource{Projected: &corev1.ProjectedVolumeSource{
			DefaultMode: new(int32(0o444)),
			Sources: []corev1.VolumeProjection{
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerName(owner)}, Items: []corev1.KeyToPath{{Key: "token", Path: "token"}}}},
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerTLSName(owner)}, Items: []corev1.KeyToPath{{Key: "ca.crt", Path: "ca.crt"}}}},
			},
		}}},
		{Name: "tmp", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{SizeLimit: new(resource.MustParse("16Mi"))}}},
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
					HostAliases:                  []corev1.HostAlias{{IP: runnerIP, Hostnames: []string{r.runnerHost(owner)}}},
					SecurityContext: &corev1.PodSecurityContext{
						RunAsUser:      &uid,
						RunAsGroup:     &gid,
						RunAsNonRoot:   &nonRoot,
						SeccompProfile: seccomp,
					},
					Containers: []corev1.Container{{
						Name:                     "seed",
						Image:                    spec.Image,
						TerminationMessagePolicy: corev1.TerminationMessageFallbackToLogsOnError,
						ImagePullPolicy:          corev1.PullPolicy(spec.ImagePullPolicy),
						Command:                  command,
						VolumeMounts:             mounts,
						SecurityContext: &corev1.SecurityContext{
							RunAsUser:                &uid,
							RunAsGroup:               &gid,
							RunAsNonRoot:             &nonRoot,
							AllowPrivilegeEscalation: new(false),
							ReadOnlyRootFilesystem:   new(true),
							Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}, Add: reader.caps},
							SeccompProfile:           seccomp,
						},
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:              resource.MustParse("100m"),
								corev1.ResourceMemory:           resource.MustParse("64Mi"),
								corev1.ResourceEphemeralStorage: resource.MustParse("32Mi"),
							},
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:              resource.MustParse("1"),
								corev1.ResourceMemory:           resource.MustParse("256Mi"),
								corev1.ResourceEphemeralStorage: resource.MustParse("128Mi"),
							},
						},
					}},
					Volumes: volumes,
				},
			},
		},
	}
	if reader.mixed {
		job.Annotations = map[string]string{annRuntimeMigrationMixedReader: "true"}
	}
	applyAgentBaseScheduling(&job.Spec.Template.Spec, cfg.AgentBase)
	if rc := agent.Spec.RuntimeClassName; rc != "" {
		job.Spec.Template.Spec.RuntimeClassName = &rc
	}
	return job, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the container ran the agent as the install's agent uid and gid, and a machine's harness runs as root, so the seed maps that uid and gid to root. The ids come from the same security context the agent's pods and the storage migration read, with the same fallback.
func runtimeMigrationOwnerMap(cfg *config.Config) string {
	uid, gid := migrationAgentIdentity(cfg)
	return fmt.Sprintf("%d:%d:0", uid, gid)
}
