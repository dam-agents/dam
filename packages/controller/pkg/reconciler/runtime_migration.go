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
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: moving an Agent from the container Backend to the vm one, reversibly until the machine has booted from the copy. The api-server is the one spec writer, so a request writes no spec: it records the target shape and a snapshot of what the switch changes, and switches the Backend itself once this reports the boot verified. Until then the container spec is the Agent's spec and the vm side is built beside it. `Requested` makes the owner's runner and the machine, stopped, while the container keeps running — the preflight; `Stopping` takes the container down and records which volume holds HOME and each other persisted path; `Copying` streams them, as one tree, to the runner as the machine's seed; `Booting` lets the machine start from it; `Verified` waits for the switch. The phase, its reason and the copy attempts are the RuntimeMigrating status condition, and every step is derived from it and from cluster state, so a restart resumes where it left off. The old volumes keep their labels until after the switch, so an abort before it leaves the container exactly where it was.
const (
	annRuntimeMigration         = "agent-platform.ai/runtime-migration"
	annRuntimeMigrationTarget   = "agent-platform.ai/runtime-migration-target"
	annRuntimeMigrationSnapshot = "agent-platform.ai/runtime-migration-snapshot"
	annRuntimeMigrationRetry    = "agent-platform.ai/runtime-migration-retry"
	annRuntimeMigrationMessage  = "agent-platform.ai/runtime-migration-message"
	annRuntimeMigrationSource   = "agent-platform.ai/runtime-migration-source"
	annRuntimeMigrationMounts   = "agent-platform.ai/runtime-migration-mounts"
	annRuntimeMigrationGrafts   = "agent-platform.ai/runtime-migration-grafts"
	annRuntimeMigrationSeed     = "agent-platform.ai/runtime-migration-seed"

	runtimeMigrationRequested = "requested"
	runtimeMigrationCopying   = "copying"
	runtimeMigrationBooting   = "booting"

	// UNIT_BOUNDARY_DESCRIPTION: the bounds that make a migration end. Three copy attempts, each a Job that itself retries twice, and a wall-clock budget from the request that covers one copy running into its own four-hour deadline with time left to boot; a migration past either is Failed, with the reason, until the user retries or aborts.
	runtimeMigrationMaxAttempts = 3
	runtimeMigrationBudget      = 6 * time.Hour

	// UNIT_BOUNDARY_DESCRIPTION: the role the copy Job's pod carries, which is what the owner's runner admits to its machine API besides the api-server and the controller. Only the controller creates pods with it, and it is paired with the owner label, so one owner's Job never reaches another owner's runner.
	RoleRuntimeMigration = "runtime-migration"

	// UNIT_BOUNDARY_DESCRIPTION: where the copy Job finds what it runs and reads. vm-seed ships in the runner image, so the Job carries exactly the tar writer the runner's reader was tested against.
	runtimeMigrationSeedBinary = "/usr/local/bin/vm-seed"
	runtimeMigrationSourcePath = "/mnt/home"
	runtimeMigrationExtraPath  = "/mnt/extra"
	runtimeMigrationCredsPath  = "/etc/vm-seed"
)

// UNIT_BOUNDARY_DESCRIPTION: a migration as the controller reads it: whether the api-server's request stands, and the phase the RuntimeMigrating condition records. A request from before the condition existed carries its phase in the request annotation instead, which is read as the same phase so a migration the previous controller started resumes. `recorded` says whether the condition exists; `since` is when it last turned true, which is where the time budget starts; `source` says the old volumes were recorded, which happens only once the container is being stopped.
type runtimeMigration struct {
	requested bool
	recorded  bool
	phase     string
	message   string
	since     time.Time
	attempts  int32
	source    bool
	seeded    bool
	retry     time.Time
}

func runtimeMigrationOf(annotations map[string]string, status apiv1.AgentStatus) runtimeMigration {
	m := runtimeMigration{
		requested: annotations[annRuntimeMigration] != "",
		source:    annotations[annRuntimeMigrationSource] != "",
		attempts:  status.RuntimeMigrationAttempts,
	}
	if _, err := runtimeMigrationSeed(annotations); err == nil {
		m.seeded = true
	}
	if t, err := time.Parse(time.RFC3339, annotations[annRuntimeMigrationRetry]); err == nil {
		m.retry = t
	}
	if c := apimeta.FindStatusCondition(status.Conditions, apiv1.ConditionRuntimeMigrating); c != nil {
		m.recorded = true
		m.phase = c.Reason
		m.message = c.Message
		m.since = c.LastTransitionTime.Time
		return m
	}
	switch annotations[annRuntimeMigration] {
	case "":
	case runtimeMigrationCopying:
		m.phase = apiv1.ReasonRuntimeMigrationCopying
	case runtimeMigrationBooting:
		m.phase = apiv1.ReasonRuntimeMigrationBooting
	default:
		m.phase = apiv1.ReasonRuntimeMigrationRequested
	}
	return m
}

func runtimeMigrationOfObject(u *unstructured.Unstructured) runtimeMigration {
	var status apiv1.AgentStatus
	if raw, ok, _ := unstructured.NestedMap(u.Object, "status"); ok && raw != nil {
		_ = runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &status)
	}
	return runtimeMigrationOf(u.GetAnnotations(), status)
}

func (m runtimeMigration) active() bool { return m.requested || m.phase != "" }

// UNIT_BOUNDARY_DESCRIPTION: whether nothing of the Agent may run — neither the container, nor the machine, nor the gateway. That holds from the moment the container is stopped until the copy has landed: the old pod would keep writing to a volume being copied, and a machine that booted would seed its disk from the image and never look at the copy again. A boot is let through only with the seed it must come from recorded, since that is what the runner and platform-init hold the boot to. A migration that failed after the container was stopped keeps it stopped until the user retries or aborts; one that failed in preflight never stopped it.
func (m runtimeMigration) holdsDown() bool {
	switch m.phase {
	case apiv1.ReasonRuntimeMigrationStopping, apiv1.ReasonRuntimeMigrationCopying:
		return true
	case apiv1.ReasonRuntimeMigrationBooting:
		return !m.seeded
	case apiv1.ReasonRuntimeMigrationFailed:
		return m.source
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: whether the machine is the side that runs. From `Booting` on it is, and the container stays down, since both would otherwise hold the Agent's home at once.
func (m runtimeMigration) vmSideRuns() bool {
	return m.phase == apiv1.ReasonRuntimeMigrationBooting || m.phase == apiv1.ReasonRuntimeMigrationVerified
}

func (m runtimeMigration) containerDown() bool {
	return m.holdsDown() || m.vmSideRuns()
}

func (m runtimeMigration) machineMayRun() bool {
	if m.phase == apiv1.ReasonRuntimeMigrationBooting && !m.seeded {
		return false
	}
	return !m.active() || m.vmSideRuns()
}

// UNIT_BOUNDARY_DESCRIPTION: the shape the machine takes, recorded by the api-server with the request: the mounts rewritten to where each persisted path lives below HOME, and the disk sized for all of them. The rest of the spec is the Agent's own, so an image changed meanwhile is the image the machine runs.
type runtimeMigrationTarget struct {
	Mounts      []apiv1.Mount `json:"mounts,omitempty"`
	StorageSize string        `json:"storageSize,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent as the vm Backend sees it while its spec is still the container's. An Agent already on the vm Backend is its own target.
func runtimeMigrationTargetAgent(agent *apiv1.Agent) (*apiv1.Agent, error) {
	target := agent.DeepCopy()
	if target.Spec.IsVM() {
		return target, nil
	}
	raw := agent.Annotations[annRuntimeMigrationTarget]
	if raw == "" {
		return nil, errors.New("the migration request names no target shape")
	}
	var shape runtimeMigrationTarget
	if err := json.Unmarshal([]byte(raw), &shape); err != nil {
		return nil, fmt.Errorf("the migration's target is not readable: %w", err)
	}
	target.Spec.Backend = &apiv1.Backend{Type: "vm"}
	target.Spec.RuntimeClassName = ""
	target.Spec.NodeSelector = nil
	if shape.Mounts != nil {
		target.Spec.Mounts = shape.Mounts
	}
	if shape.StorageSize != "" {
		target.Spec.StorageSize = shape.StorageSize
	}
	return target, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent that owns a machine on its owner's runner, as the vm Backend sees it, or nil: a vm Agent, or a container Agent whose migration request gives it a machine beside the container.
func vmSideOf(agent *apiv1.Agent) *apiv1.Agent {
	if agent.Spec.IsVM() {
		return agent
	}
	if agent.Annotations[annRuntimeMigration] == "" {
		return nil
	}
	target, err := runtimeMigrationTargetAgent(agent)
	if err != nil {
		return nil
	}
	return target
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

// UNIT_BOUNDARY_DESCRIPTION: what the machine's spec says about the seed: the one a booting migration expects, and nothing otherwise, so a machine whose migration was verified or ended boots whatever home its disk holds.
func runtimeMigrationExpectSeed(agent *apiv1.Agent) *vmrunner.SeedResult {
	if runtimeMigrationOf(agent.Annotations, agent.Status).phase != apiv1.ReasonRuntimeMigrationBooting {
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

func setRuntimeMigrating(s *apiv1.AgentStatus, phase, message string, generation int64) {
	setStatusCondition(s, apiv1.ConditionRuntimeMigrating, phase != apiv1.ReasonRuntimeMigrationFailed, phase, phase, message, generation)
}

// UNIT_BOUNDARY_DESCRIPTION: moves the migration to a phase, with the message that goes with it, and updates the view the rest of this reconcile acts on.
func (r *AgentReconciler) runtimeMigrationPhase(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, phase, message string) error {
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setRuntimeMigrating(s, phase, message, agent.Generation)
	}); err != nil {
		return err
	}
	if phase != m.phase {
		slog.Info("runtime migration: phase", "agent", agent.Name, "from", m.phase, "to", phase)
	}
	m.recorded, m.phase, m.message = true, phase, message
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: what the user is shown while a step waits or is stuck. The phase stays where it is and the step is retried, so the message is advice about the present, replaced as soon as the step gets past it.
func (r *AgentReconciler) noteRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, cause error) error {
	msg := cause.Error()
	if msg != m.message {
		slog.Warn("runtime migration: step not done", "agent", agent.Name, "phase", m.phase, "reason", msg)
	}
	return r.runtimeMigrationPhase(ctx, agent, m, m.phase, msg)
}

func (r *AgentReconciler) failRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, why string) error {
	slog.Warn("runtime migration: failed", "agent", agent.Name, "phase", m.phase, "reason", why)
	return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationFailed, why)
}

// UNIT_BOUNDARY_DESCRIPTION: the condition is written before anything is made on the vm side, so an abort that follows always finds a condition saying there is something to remove.
func (r *AgentReconciler) beginRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration) error {
	if !m.requested || m.recorded {
		return nil
	}
	return r.runtimeMigrationPhase(ctx, agent, m, m.phase, "")
}

// UNIT_BOUNDARY_DESCRIPTION: on the vm Backend no container reconcile scales the old StatefulSet down, so once the Backend has switched — or for a migration whose request switched it at once, from an api-server that predates this flow — the StatefulSet and the headless Service a pod needed are removed here once the old volumes are recorded, before the machine is ensured, so the vm reconcile creates the ClusterIP Service a machine needs.
func (r *AgentReconciler) prepareRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m runtimeMigration) error {
	switch {
	case m.phase == apiv1.ReasonRuntimeMigrationVerified:
	case m.requested && m.source && m.phase != apiv1.ReasonRuntimeMigrationFailed:
	default:
		return nil
	}
	ns := r.config.Namespace
	if err := r.client.AppsV1().StatefulSets(ns).Delete(ctx, agent.Name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("deleting the container statefulset: %w", err)
	}
	svc, err := r.client.CoreV1().Services(ns).Get(ctx, agent.Name, metav1.GetOptions{})
	if err == nil && svc.Spec.ClusterIP == corev1.ClusterIPNone {
		if err := r.client.CoreV1().Services(ns).Delete(ctx, agent.Name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
			return fmt.Errorf("deleting the headless agent service: %w", err)
		}
	} else if err != nil && !k8serrors.IsNotFound(err) {
		return err
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: how soon a container Agent whose migration is under way is reconciled again. Nothing about the Agent changes while its machine is made or its copy runs, so without this a phase would advance only on the next unrelated event.
const runtimeMigrationPoll = 5 * time.Second

// UNIT_BOUNDARY_DESCRIPTION: the machine a container Agent's migration builds beside it, in the shape the request recorded. A wait on the runner or its certificate, or a refusal, is returned for the migration to show rather than failing the reconcile of a container that is still serving.
func (r *AgentReconciler) reconcileMigrationMachine(ctx context.Context, agent *apiv1.Agent, ownerRef metav1.OwnerReference, gatewayIP string, running bool) (vmrunner.MachineStatus, bool, error) {
	if !r.config.VM.Enabled {
		return vmrunner.MachineStatus{}, false, errors.New("virtualization is disabled in this install (virtualization.enabled)")
	}
	target, err := runtimeMigrationTargetAgent(agent)
	if err != nil {
		return vmrunner.MachineStatus{}, false, err
	}
	return r.reconcileVMAgent(ctx, target, ownerRef, gatewayIP, running, false)
}

// UNIT_BOUNDARY_DESCRIPTION: advances the migration by at most one phase, from what the runner said about the machine this reconcile. `vmErr` is why the vm side could not be ensured, shown on the phase that waits for it rather than failing the container's reconcile.
func (r *AgentReconciler) continueRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m runtimeMigration, machine vmrunner.MachineStatus, runnerReached bool, vmErr error) error {
	switch {
	case agent.Spec.IsVM() && m.phase == apiv1.ReasonRuntimeMigrationVerified:
		if !runnerReached {
			return nil
		}
		return r.finishRuntimeMigration(ctx, agent)
	case !m.requested && agent.Spec.IsVM():
		return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
			apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionRuntimeMigrating)
			s.RuntimeMigrationAttempts = 0
		})
	case !m.requested:
		return r.clearRuntimeMigration(ctx, agent, false)
	case m.phase == apiv1.ReasonRuntimeMigrationFailed:
		if !m.retry.After(m.since) {
			return nil
		}
		slog.Info("runtime migration: retry requested, starting over", "agent", agent.Name)
		return r.clearRuntimeMigration(ctx, agent, true)
	case m.phase != apiv1.ReasonRuntimeMigrationVerified && !m.since.IsZero() && time.Since(m.since) > runtimeMigrationBudget:
		why := fmt.Sprintf("the migration did not finish within %s", runtimeMigrationBudget)
		if m.message != "" {
			why += " (" + m.message + ")"
		}
		return r.failRuntimeMigration(ctx, agent, &m, why)
	}
	switch m.phase {
	case apiv1.ReasonRuntimeMigrationRequested:
		return r.preflightRuntimeMigration(ctx, agent, &m, machine, runnerReached, vmErr)
	case apiv1.ReasonRuntimeMigrationStopping:
		return r.stopForRuntimeMigration(ctx, agent, &m)
	case apiv1.ReasonRuntimeMigrationCopying:
		if !runnerReached || machine.State != vmrunner.StateStopped {
			return nil
		}
		return r.runRuntimeMigrationCopy(ctx, agent, &m)
	case apiv1.ReasonRuntimeMigrationBooting:
		return r.bootRuntimeMigration(ctx, agent, &m, machine, runnerReached)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the preflight passes once the owner's runner is up and the machine exists and is stopped: the runner was scheduled, the image was fetched and unpacked, and the disk was made. Memory is admitted only when a machine starts, so a runner too small for it is found at `Booting`, which is still before the point of no return.
func (r *AgentReconciler) preflightRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, machine vmrunner.MachineStatus, runnerReached bool, vmErr error) error {
	if runnerReached && machine.State == vmrunner.StateStopped && machine.Reason == "" {
		return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationStopping, "")
	}
	why := "preparing the new machine while the agent keeps running"
	switch {
	case vmErr != nil:
		why = vmErr.Error()
	case machine.Message != "":
		why = machine.Message
	case machine.Reason != "":
		why = machine.Reason
	case !runnerReached:
		why = "waiting for the owner's VM runner"
	}
	return r.noteRuntimeMigration(ctx, agent, m, errors.New(why))
}

// UNIT_BOUNDARY_DESCRIPTION: scales the container's StatefulSet to zero and keeps it, rather than deleting it, so an abort scales it back up on the same claims. Only the agent's own StatefulSet: from `Booting` on the gateway serves the machine.
func (r *AgentReconciler) stopContainerForRuntimeMigration(ctx context.Context, name string) error {
	sts := r.client.AppsV1().StatefulSets(r.config.Namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		ss, err := sts.Get(ctx, name, metav1.GetOptions{})
		if k8serrors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if ss.Spec.Replicas != nil && *ss.Spec.Replicas == 0 {
			return nil
		}
		ss.Spec.Replicas = new(int32(0))
		_, err = sts.Update(ctx, ss, metav1.UpdateOptions{})
		return err
	})
}

// UNIT_BOUNDARY_DESCRIPTION: the source volumes are recorded once, while the old StatefulSet still names them, and the phase moves on only once the old pod is gone. The container reconcile has already scaled the StatefulSet to zero.
func (r *AgentReconciler) stopForRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration) error {
	name := agent.Name
	patch := map[string]*string{}
	if agent.Annotations[annRuntimeMigrationSource] == "" {
		source, err := r.runtimeMigrationSource(ctx, agent)
		if err != nil {
			return r.noteRuntimeMigration(ctx, agent, m, err)
		}
		grafts, err := r.runtimeMigrationGrafts(ctx, agent)
		if err != nil {
			return r.noteRuntimeMigration(ctx, agent, m, err)
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
	if len(patch) > 0 {
		if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, patch); err != nil {
			return err
		}
	}
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + name + "," + LabelRole + "=" + RoleAgent,
	})
	if err != nil {
		return err
	}
	if len(pods.Items) > 0 {
		return nil
	}
	slog.Info("runtime migration: container pod gone, copying home", "agent", name)
	return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationCopying, "")
}

// UNIT_BOUNDARY_DESCRIPTION: removes what the vm side made — the copy Job, the machine with its disk and its seed, and the record of which volumes were copied — and then the condition, so a crash anywhere in between is finished by the next reconcile. The old volumes are not touched: they never lost their labels, so the container resumes on them. For an abort the condition goes; for a retry the migration starts over from the preflight with a fresh machine, because a machine whose boot failed may have seeded part of its disk.
func (r *AgentReconciler) clearRuntimeMigration(ctx context.Context, agent *apiv1.Agent, retry bool) error {
	name := agent.Name
	prop := metav1.DeletePropagationBackground
	if err := r.client.BatchV1().Jobs(r.config.Namespace).Delete(ctx, runtimeMigrationJobName(name), metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("deleting the home copy job: %w", err)
	}
	if err := r.deleteMachine(ctx, name, agent.Labels[envoyOwnerLabel]); err != nil {
		return err
	}
	if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigrationSource:  nil,
		annRuntimeMigrationGrafts:  nil,
		annRuntimeMigrationSeed:    nil,
		annRuntimeMigrationMessage: nil,
	}); err != nil {
		return err
	}
	if retry {
		return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
			setRuntimeMigrating(s, apiv1.ReasonRuntimeMigrationRequested, "retrying from the start", agent.Generation)
			s.RuntimeMigrationAttempts = 0
		})
	}
	slog.Info("runtime migration: aborted, the agent stays on the container backend", "agent", name)
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionRuntimeMigrating)
		s.RuntimeMigrationAttempts = 0
	})
}

// UNIT_BOUNDARY_DESCRIPTION: what counts as the machine having booted from the copy: its guest answered, and the runner reports that its home was restored from exactly the seed this migration recorded. It is the point past which the migration cannot be aborted, so it lives in one place.
func runtimeMigrationBootVerified(machine vmrunner.MachineStatus, expected vmrunner.SeedResult) bool {
	return machine.Ready && machine.HomeSeededFrom == expected.SHA256
}

// UNIT_BOUNDARY_DESCRIPTION: `Verified` is written only while the request still stands, in the same compare-and-swap as the status update: an abort that lands between the read and the write makes the write conflict, and the retry sees the request gone. The api-server's abort checks for `Verified` the same way, so exactly one of the two wins.
func (r *AgentReconciler) bootRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, machine vmrunner.MachineStatus, runnerReached bool) error {
	if !runnerReached {
		return nil
	}
	expected, err := runtimeMigrationSeed(agent.Annotations)
	if err != nil {
		return r.copyRuntimeMigrationAgain(ctx, agent, m, err.Error())
	}
	if machine.Reason == vmrunner.ReasonSeedMissing {
		return r.copyRuntimeMigrationAgain(ctx, agent, m, "the runner does not hold the copied home: "+machine.Message)
	}
	if machine.Ready && !runtimeMigrationBootVerified(machine, expected) {
		from := "the image"
		if machine.HomeSeededFrom != "" {
			from = "seed " + machine.HomeSeededFrom
		}
		return r.copyRuntimeMigrationAgain(ctx, agent, m, fmt.Sprintf("the new machine answered with a home from %s, not from the copy (seed %s)", from, expected.SHA256))
	}
	if runtimeMigrationBootVerified(machine, expected) {
		applied, err := updateAgentStatusWhile(ctx, r.dynamic, r.config.Namespace, agent.Name,
			func(u *unstructured.Unstructured) bool { return u.GetAnnotations()[annRuntimeMigration] != "" },
			func(s *apiv1.AgentStatus) {
				setRuntimeMigrating(s, apiv1.ReasonRuntimeMigrationVerified, "", agent.Generation)
			})
		if err == nil && applied {
			slog.Info("runtime migration: the machine booted from the copy", "agent", agent.Name)
		}
		return err
	}
	if machine.Reason == vmrunner.ReasonBootFailed || machine.Reason == vmrunner.ReasonImageUnavailable || machine.Reason == vmrunner.ReasonOutOfCapacity {
		msg := machine.Message
		if msg == "" {
			msg = machine.Reason
		}
		return r.noteRuntimeMigration(ctx, agent, m, fmt.Errorf("the new machine has not started: %s", msg))
	}
	return nil
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

// UNIT_BOUNDARY_DESCRIPTION: the `Copying` phase. A copy waits for the machine to exist and be stopped — the runner refuses a seed otherwise. Each Job is an attempt, counted before it is created, so a controller that restarts mid-way counts one too many rather than one too few; once the attempts are spent the migration is Failed with the last attempt's error. On success it moves to `Booting` with a fresh activity stamp, so the machine boots once even for an agent that was asleep: the copy is only proven by a guest that seeded from it.
func (r *AgentReconciler) runRuntimeMigrationCopy(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration) error {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	source := agent.Annotations[annRuntimeMigrationSource]
	if source == "" {
		return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationStopping, "")
	}
	jobs := r.client.BatchV1().Jobs(r.config.Namespace)
	job, err := jobs.Get(ctx, runtimeMigrationJobName(name), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		if m.attempts >= runtimeMigrationMaxAttempts {
			return r.failRuntimeMigration(ctx, agent, m, fmt.Sprintf("copying the home directory failed %d times: %s", m.attempts, m.message))
		}
		if err := ensureMigrationServiceAccount(ctx, r.client, r.config.Namespace); err != nil {
			return err
		}
		if _, err := runtimeMigrationTargetAgent(agent); err != nil {
			return r.noteRuntimeMigration(ctx, agent, m, err)
		}
		grafts, err := recordedGrafts(agent)
		if err != nil {
			return r.noteRuntimeMigration(ctx, agent, m, err)
		}
		desired, err := r.buildRuntimeMigrationJob(agent, owner, source, grafts)
		if err != nil {
			return err
		}
		attempt := m.attempts + 1
		if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
			s.RuntimeMigrationAttempts = attempt
		}); err != nil {
			return err
		}
		m.attempts = attempt
		if _, err := jobs.Create(ctx, desired, metav1.CreateOptions{}); err != nil && !k8serrors.IsAlreadyExists(err) {
			return fmt.Errorf("creating the home copy job: %w", err)
		}
		slog.Info("runtime migration: home copy started", "agent", name, "pvc", source, "attempt", attempt)
		return nil
	}
	if err != nil {
		return err
	}
	if job.DeletionTimestamp != nil {
		return nil
	}
	prop := metav1.DeletePropagationBackground
	switch {
	case jobConditionTrue(job, batchv1.JobComplete):
		seed, why, err := r.copyJobSeed(ctx, job)
		if err != nil {
			return err
		}
		if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
			return fmt.Errorf("deleting the home copy job: %w", err)
		}
		if why != "" {
			return r.noteRuntimeMigration(ctx, agent, m, fmt.Errorf("the home was copied, but %s; copying it again", why))
		}
		encoded, err := json.Marshal(seed)
		if err != nil {
			return err
		}
		slog.Info("runtime migration: home copied, booting the machine", "agent", name, "seedBytes", seed.Bytes, "seedSHA256", seed.SHA256)
		if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
			annRuntimeMigrationSeed: new(string(encoded)),
			annLastActivity:         new(time.Now().UTC().Format(time.RFC3339)),
		}); err != nil {
			return err
		}
		return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationBooting, "")
	case jobConditionTrue(job, batchv1.JobFailed):
		why := "copying the home directory failed"
		if detail := r.copyJobFailure(ctx, job); detail != "" {
			why = fmt.Sprintf("copying the home directory failed (%s)", detail)
		}
		if m.attempts >= runtimeMigrationMaxAttempts {
			return r.failRuntimeMigration(ctx, agent, m, fmt.Sprintf("%s; gave up after %d attempts", why, m.attempts))
		}
		if err := r.noteRuntimeMigration(ctx, agent, m, fmt.Errorf("%s; retrying (attempt %d of %d)", why, m.attempts, runtimeMigrationMaxAttempts)); err != nil {
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

// UNIT_BOUNDARY_DESCRIPTION: a boot that cannot prove it came from the copy — the seed was not recorded, the runner lost it, or the guest answered with a home from anything else — is not a verified migration. The old volumes still carry their labels, since only the switch releases them, so going back to `Copying` is safe. The machine is deleted first, so the new copy lands on a fresh disk that platform-init restores instead of keeping the home already there; the next reconcile creates the machine stopped again. The new copy is one more attempt, so a boot that keeps failing the match ends the migration as Failed like a copy that keeps failing.
func (r *AgentReconciler) copyRuntimeMigrationAgain(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, why string) error {
	name := agent.Name
	if err := r.deleteMachine(ctx, name, agent.Labels[envoyOwnerLabel]); err != nil {
		return fmt.Errorf("deleting the machine to copy its home again: %w", err)
	}
	if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigrationSeed: nil,
	}); err != nil {
		return err
	}
	msg := why + "; copying the home again"
	slog.Warn("runtime migration: the boot is not proven to come from the copy", "agent", name, "reason", msg)
	return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationCopying, msg)
}

// UNIT_BOUNDARY_DESCRIPTION: runs once the Backend has switched: the seed is removed, each volume the copy was read from is retained for its window, and the migration's records and condition go. Until the switch those volumes kept their labels, so an abort could still resume the container on them.
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
	if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigration:         nil,
		annRuntimeMigrationTarget:   nil,
		annRuntimeMigrationSnapshot: nil,
		annRuntimeMigrationRetry:    nil,
		annRuntimeMigrationMessage:  nil,
		annRuntimeMigrationSource:   nil,
		annRuntimeMigrationMounts:   nil,
		annRuntimeMigrationGrafts:   nil,
		annRuntimeMigrationSeed:     nil,
	}); err != nil {
		return err
	}
	slog.Info("runtime migration: agent moved to the vm backend", "agent", name)
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionRuntimeMigrating)
		s.RuntimeMigrationAttempts = 0
	})
}

// UNIT_BOUNDARY_DESCRIPTION: the Job reads the old volumes read-only as root — the home and every other persisted volume the migration carries, each grafted into the seed where the rewritten spec put it below HOME — HOME holds files owned by the agent's user with private modes, and the tar has to carry them exactly — and reaches only the owner's runner, with the runner's token and the CA that signed its serving certificate. It runs where the agent's pods run, since that is where its volumes attach.
func (r *AgentReconciler) buildRuntimeMigrationJob(agent *apiv1.Agent, owner, source string, grafts []runtimeMigrationGraft) (*batchv1.Job, error) {
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
		"--result-file", corev1.TerminationMessagePathDefault,
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
