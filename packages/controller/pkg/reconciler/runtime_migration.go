package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/util/retry"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: moving an Agent from the container Backend to the vm one, reversibly until the machine has booted from the copy. The api-server is the one spec writer, so a request writes no spec: it records the target shape and a snapshot of what the switch changes, and switches the Backend itself once this reports the boot verified. Until then the container spec is the Agent's spec and the vm side is built beside it. `Requested` makes the owner's runner and the machine, stopped, while the container keeps running — the preflight; `Stopping` takes the container down and records which volume holds HOME; `Copying` streams it to the runner as the machine's seed; `Booting` lets the machine start from it; `Verified` waits for the switch. The phase, its reason and the copy attempts are the RuntimeMigrating status condition, and every step is derived from it and from cluster state, so a restart resumes where it left off. The old volumes keep their labels until after the switch, so an abort before it leaves the container exactly where it was.
const (
	annRuntimeMigration         = "agent-platform.ai/runtime-migration"
	annRuntimeMigrationTarget   = "agent-platform.ai/runtime-migration-target"
	annRuntimeMigrationSnapshot = "agent-platform.ai/runtime-migration-snapshot"
	annRuntimeMigrationRetry    = "agent-platform.ai/runtime-migration-retry"
	annRuntimeMigrationMessage  = "agent-platform.ai/runtime-migration-message"
	annRuntimeMigrationSource   = "agent-platform.ai/runtime-migration-source"
	annRuntimeMigrationSeed     = "agent-platform.ai/runtime-migration-seed"
	annRuntimeMigrationEmpty    = "agent-platform.ai/runtime-migration-nothing-to-copy"

	runtimeMigrationRequested = "requested"
	runtimeMigrationCopying   = "copying"
	runtimeMigrationBooting   = "booting"

	// UNIT_BOUNDARY_DESCRIPTION: the bounds that make a migration end. Three copy attempts, each a Job of one pod, and a wall-clock budget from the request that covers one copy running into its own four-hour deadline with time left to boot; a migration past either is Failed, with the reason, until the user retries or aborts.
	runtimeMigrationMaxAttempts = 3
	runtimeMigrationBudget      = 6 * time.Hour

	// UNIT_BOUNDARY_DESCRIPTION: the role the copy Job's pod carries, which is what the owner's runner admits to its machine API besides the api-server and the controller. Only the controller creates pods with it, and it is paired with the owner label, so one owner's Job never reaches another owner's runner.
	RoleRuntimeMigration = "runtime-migration"

	// UNIT_BOUNDARY_DESCRIPTION: where the copy Job finds what it runs and reads. vm-seed ships in the runner image, so the Job carries exactly the tar writer the runner's reader was tested against.
	runtimeMigrationSeedBinary = "/usr/local/bin/vm-seed"
	runtimeMigrationSourcePath = "/mnt/home"
	runtimeMigrationCredsPath  = "/etc/vm-seed"

	runtimeMigrationCapabilityKey = "capability"
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
	empty     bool
	retry     time.Time
	held      string
}

func runtimeMigrationOf(annotations map[string]string, status apiv1.AgentStatus) runtimeMigration {
	m := runtimeMigration{
		requested: annotations[annRuntimeMigration] != "",
		source:    annotations[annRuntimeMigrationSource] != "",
		empty:     annotations[annRuntimeMigrationEmpty] == "true",
		attempts:  status.RuntimeMigrationAttempts,
	}
	if _, err := runtimeMigrationSeed(annotations); err == nil || m.empty {
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

// UNIT_BOUNDARY_DESCRIPTION: whether the migration itself keeps the Agent up, whatever its activity says. A boot is proven only by a guest that answers, so from `Booting` with its seed recorded until that answer, neither the idle timeout nor a reclaim may stop it; a stop the user asks for still wins. A boot with nothing to copy is held to no seed and counts as recorded.
func (m runtimeMigration) keepsUp() bool {
	return m.phase == apiv1.ReasonRuntimeMigrationBooting && m.seeded
}

func (m runtimeMigration) containerDown() bool {
	return m.holdsDown() || m.vmSideRuns()
}

// UNIT_BOUNDARY_DESCRIPTION: whether a seed capability may seed the machine: from the preflight that builds it until the copy has landed. The runner reads this mark off the spec it holds, so the machine stops being seedable the moment the controller moves the migration to `Booting`, fails it, or drops the request.
func (m runtimeMigration) seedable() bool {
	if !m.requested {
		return false
	}
	switch m.phase {
	case apiv1.ReasonRuntimeMigrationRequested, apiv1.ReasonRuntimeMigrationStopping, apiv1.ReasonRuntimeMigrationCopying:
		return true
	}
	return false
}

func (m runtimeMigration) machineMayRun() bool {
	if m.phase == apiv1.ReasonRuntimeMigrationBooting && !m.seeded {
		return false
	}
	return !m.active() || m.vmSideRuns()
}

// UNIT_BOUNDARY_DESCRIPTION: the shape the machine takes, recorded by the api-server with the request: the disk's size when HOME asked for more than the Agent does. The rest of the spec is the Agent's own, so an image changed meanwhile is the image the machine runs.
type runtimeMigrationTarget struct {
	StorageSize string `json:"storageSize,omitempty"`
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
	message = r.sanitizeFor(agent, message)
	if m.recorded && phase == m.phase && message == m.message {
		return nil
	}
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setRuntimeMigrating(s, phase, message, agent.Generation)
	}); err != nil {
		return err
	}
	if phase != m.phase {
		slog.Info("runtime migration: phase", "agent", agent.Name, "from", m.phase, "to", phase)
		kind := corev1.EventTypeNormal
		if phase == apiv1.ReasonRuntimeMigrationFailed {
			kind = corev1.EventTypeWarning
		}
		r.migrationEvent(ctx, agent, kind, "RuntimeMigration"+phase, message)
	}
	m.recorded, m.phase, m.message = true, phase, message
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: what the user is shown while a step waits or is stuck. The phase stays where it is and the step is retried, so the message is advice about the present, replaced as soon as the step gets past it.
func (r *AgentReconciler) noteRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, cause error) error {
	return r.setRuntimeMigrationNote(ctx, agent, m, cause.Error())
}

// UNIT_BOUNDARY_DESCRIPTION: writes what holds the current phase up, or clears it once nothing does, so the message always says what is true now. It is written only when it changed.
func (r *AgentReconciler) setRuntimeMigrationNote(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, note string) error {
	if msg := r.sanitizeFor(agent, note); msg != m.message && msg != "" {
		slog.Warn("runtime migration: step not done", "agent", agent.Name, "phase", m.phase, "reason", msg)
	}
	return r.runtimeMigrationPhase(ctx, agent, m, m.phase, note)
}

func (r *AgentReconciler) failRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, why string) error {
	slog.Warn("runtime migration: failed", "agent", agent.Name, "phase", m.phase, "reason", why)
	if err := r.deleteSeedCapability(ctx, agent.Name); err != nil {
		return err
	}
	if err := r.deleteRuntimeMigrationNetworkPolicy(ctx, agent.Name); err != nil {
		return err
	}
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
			return r.setRuntimeMigrationNote(ctx, agent, &m, vmSideProblem(machine, runnerReached, vmErr))
		}
		return r.runRuntimeMigrationCopy(ctx, agent, &m)
	case apiv1.ReasonRuntimeMigrationBooting:
		return r.bootRuntimeMigration(ctx, agent, &m, machine, runnerReached, vmErr)
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

// UNIT_BOUNDARY_DESCRIPTION: the source volumes are recorded once, while the old StatefulSet still names them, and the phase moves on only once the old pod is gone. The container reconcile has already scaled the StatefulSet to zero. A pod that stays terminating is named with its node, since only someone who can reach that node can end it. An Agent that never had a volume at all has nothing to copy, and goes straight to `Booting` from the image, still through the verified boot and the switch.
func (r *AgentReconciler) stopForRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration) error {
	name := agent.Name
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent + "=" + name + "," + LabelRole + "=" + RoleAgent,
	})
	if err != nil {
		return err
	}
	patch := map[string]*string{}
	if agent.Annotations[annRuntimeMigrationSource] == "" {
		source, err := r.runtimeMigrationVolume(ctx, agent, agentHomeDir)
		if err != nil {
			return r.noteRuntimeMigration(ctx, agent, m, err)
		}
		if source == "" {
			if len(pods.Items) > 0 {
				return r.setRuntimeMigrationNote(ctx, agent, m, stuckTerminating(pods.Items, time.Now()))
			}
			return r.runtimeMigrationWithNothingToCopy(ctx, agent, m)
		}
		patch[annRuntimeMigrationSource] = new(source)
	}
	if len(patch) > 0 {
		if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, patch); err != nil {
			return err
		}
	}
	if len(pods.Items) > 0 {
		return r.setRuntimeMigrationNote(ctx, agent, m, stuckTerminating(pods.Items, time.Now()))
	}
	slog.Info("runtime migration: container pod gone, copying home", "agent", name)
	return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationCopying, "")
}

// UNIT_BOUNDARY_DESCRIPTION: an Agent with no volume at all goes straight to `Booting` with nothing to copy, once that is provable. Its machine is held to no seed and starts from the image; the boot is verified by the guest answering with a home the image made, and the switch follows as for any migration.
func (r *AgentReconciler) runtimeMigrationWithNothingToCopy(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration) error {
	empty, why, err := r.runtimeMigrationHasNothingToCopy(ctx, agent)
	if err != nil {
		return err
	}
	if !empty {
		return r.setRuntimeMigrationNote(ctx, agent, m, why)
	}
	if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, agent.Name, map[string]*string{
		annRuntimeMigrationEmpty: new("true"),
		annLastActivity:          new(time.Now().UTC().Format(time.RFC3339)),
	}); err != nil {
		return err
	}
	m.empty, m.seeded = true, true
	slog.Info("runtime migration: nothing to copy, booting from the image", "agent", agent.Name)
	return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationBooting, runtimeMigrationNothingToCopy)
}

// UNIT_BOUNDARY_DESCRIPTION: removes what the vm side made — the copy Job, the machine with its disk and its seed, and the record of which volumes were copied — and then the condition, so a crash anywhere in between is finished by the next reconcile. The old volumes are not touched: they never lost their labels, so the container resumes on them. For an abort the condition goes; for a retry the migration starts over from the preflight with a fresh machine, because a machine whose boot failed may have seeded part of its disk.
func (r *AgentReconciler) clearRuntimeMigration(ctx context.Context, agent *apiv1.Agent, retry bool) error {
	name := agent.Name
	prop := metav1.DeletePropagationBackground
	if err := r.client.BatchV1().Jobs(r.config.Namespace).Delete(ctx, runtimeMigrationJobName(name), metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("deleting the home copy job: %w", err)
	}
	if err := r.deleteRuntimeMigrationNetworkPolicy(ctx, name); err != nil {
		return err
	}
	if err := r.deleteSeedCapability(ctx, name); err != nil {
		return err
	}
	if err := r.deleteMachine(ctx, name, agent.Labels[envoyOwnerLabel]); err != nil {
		return err
	}
	if err := patchAgentAnnotations(ctx, r.dynamic, r.config.Namespace, name, map[string]*string{
		annRuntimeMigrationSource:  nil,
		annRuntimeMigrationSeed:    nil,
		annRuntimeMigrationEmpty:   nil,
		annRuntimeMigrationMessage: nil,
	}); err != nil {
		return err
	}
	if retry {
		r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigrationRetrying", "the migration starts over from the preflight with a fresh machine")
		return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
			setRuntimeMigrating(s, apiv1.ReasonRuntimeMigrationRequested, "retrying from the start", agent.Generation)
			s.RuntimeMigrationAttempts = 0
		})
	}
	slog.Info("runtime migration: aborted, the agent stays on the container backend", "agent", name)
	r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigrationAborted", "the migration was withdrawn; the agent stays on the container backend")
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionRuntimeMigrating)
		s.RuntimeMigrationAttempts = 0
	})
}

// UNIT_BOUNDARY_DESCRIPTION: what counts as the machine having booted from the copy: its guest answered, and the runner reports that its home was restored from exactly the seed this migration recorded. It is the point past which the migration cannot be aborted, so it lives in one place.
func runtimeMigrationBootVerified(machine vmrunner.MachineStatus, expected vmrunner.SeedResult) bool {
	return machine.Ready && machine.HomeSeededFrom == expected.SHA256
}

// UNIT_BOUNDARY_DESCRIPTION: `Verified` is written only while the request still stands, in the same compare-and-swap as the status update: an abort that lands between the read and the write makes the write conflict, and the retry sees the request gone. The api-server's abort checks for `Verified` the same way, so exactly one of the two wins. Until the guest answers, whatever keeps it from booting — a stop the user asked for, an owner budget with no room, or what the runner reports — is the phase's message.
func (r *AgentReconciler) bootRuntimeMigration(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, machine vmrunner.MachineStatus, runnerReached bool, vmErr error) error {
	if !runnerReached {
		return r.setRuntimeMigrationNote(ctx, agent, m, firstNote(m.held, vmSideProblem(machine, runnerReached, vmErr)))
	}
	verified := machine.Ready && machine.HomeSeededFrom == ""
	if !m.empty {
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
		verified = runtimeMigrationBootVerified(machine, expected)
	}
	if verified {
		applied, err := updateAgentStatusWhile(ctx, r.dynamic, r.config.Namespace, agent.Name,
			func(u *unstructured.Unstructured) bool { return u.GetAnnotations()[annRuntimeMigration] != "" },
			func(s *apiv1.AgentStatus) {
				setRuntimeMigrating(s, apiv1.ReasonRuntimeMigrationVerified, "", agent.Generation)
			})
		if err == nil && applied {
			slog.Info("runtime migration: the machine booted from the copy", "agent", agent.Name)
			r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigration"+apiv1.ReasonRuntimeMigrationVerified, "the new machine answered with the copied home; the backend switches next")
		}
		return err
	}
	note := firstNote(m.held, vmSideProblem(machine, runnerReached, vmErr))
	if note == "" && m.empty {
		note = runtimeMigrationNothingToCopy
	}
	return r.setRuntimeMigrationNote(ctx, agent, m, note)
}

func firstNote(notes ...string) string {
	for _, n := range notes {
		if n != "" {
			return n
		}
	}
	return ""
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

// UNIT_BOUNDARY_DESCRIPTION: the `Copying` phase. A copy waits for the machine to exist and be stopped — the runner refuses a seed otherwise. Each Job is an attempt, counted just before it is created, so a controller that restarts mid-way counts one too many rather than one too few, and a copy that waits for a slot, or a Job left by an earlier Agent of the same name, counts nothing; once the attempts are spent the migration is Failed with the last attempt's error. On success it moves to `Booting` with a fresh activity stamp, so the machine boots once even for an agent that was asleep: the copy is only proven by a guest that seeded from it.
func (r *AgentReconciler) runRuntimeMigrationCopy(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration) error {
	name := agent.Name
	owner := agent.Labels[envoyOwnerLabel]
	source := agent.Annotations[annRuntimeMigrationSource]
	if source == "" {
		return r.runtimeMigrationPhase(ctx, agent, m, apiv1.ReasonRuntimeMigrationStopping, "")
	}
	jobs := r.client.BatchV1().Jobs(r.config.Namespace)
	prop := metav1.DeletePropagationBackground
	job, err := jobs.Get(ctx, runtimeMigrationJobName(name), metav1.GetOptions{})
	if err == nil && !ownedBy(job, agent) {
		slog.Warn("runtime migration: removing a copy job another agent of this name left", "agent", name, "job", job.Name)
		if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
			return fmt.Errorf("deleting a stale home copy job: %w", err)
		}
		return r.setRuntimeMigrationNote(ctx, agent, m, "a copy job left by an earlier agent of the same name was removed; the copy starts again")
	}
	if k8serrors.IsNotFound(err) {
		if m.attempts >= runtimeMigrationMaxAttempts {
			return r.failRuntimeMigration(ctx, agent, m, fmt.Sprintf("copying the home directory failed %d times: %s", m.attempts, m.message))
		}
		return r.startRuntimeMigrationCopy(ctx, agent, m, owner, source)
	}
	if err != nil {
		return err
	}
	if job.DeletionTimestamp != nil {
		return nil
	}
	switch {
	case jobConditionTrue(job, batchv1.JobComplete):
		seed, why, err := r.copyJobSeed(ctx, job)
		if err != nil {
			return err
		}
		if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
			return fmt.Errorf("deleting the home copy job: %w", err)
		}
		if err := r.deleteRuntimeMigrationNetworkPolicy(ctx, name); err != nil {
			return err
		}
		if err := r.deleteSeedCapability(ctx, name); err != nil {
			return err
		}
		if why != "" {
			msg := fmt.Sprintf("the home was copied, but %s; copying it again", why)
			r.migrationEvent(ctx, agent, corev1.EventTypeWarning, "RuntimeMigrationCopyFailed", msg)
			return r.setRuntimeMigrationNote(ctx, agent, m, msg)
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
		note := fmt.Sprintf("%s; retrying (attempt %d of %d)", why, m.attempts, runtimeMigrationMaxAttempts)
		if r.sanitizeFor(agent, note) != m.message {
			r.migrationEvent(ctx, agent, corev1.EventTypeWarning, "RuntimeMigrationCopyFailed", note)
		}
		if err := r.setRuntimeMigrationNote(ctx, agent, m, note); err != nil {
			return err
		}
		if time.Since(job.CreationTimestamp.Time) < migrationJobRetryAfter {
			return nil
		}
		slog.Warn("runtime migration: deleting failed home copy job for retry", "agent", name, "job", job.Name)
		if err := jobs.Delete(ctx, job.Name, metav1.DeleteOptions{PropagationPolicy: &prop}); err != nil && !k8serrors.IsNotFound(err) {
			return err
		}
		if err := r.deleteRuntimeMigrationNetworkPolicy(ctx, name); err != nil {
			return err
		}
		return r.deleteSeedCapability(ctx, name)
	}
	return r.setRuntimeMigrationNote(ctx, agent, m, r.copyPodWaiting(ctx, job))
}

// UNIT_BOUNDARY_DESCRIPTION: how long a seed capability outlives its Job's active deadline: the time its pod may wait to be scheduled and pull the runner image before the deadline's clock matters. Past it the runner refuses the capability, and a retry is a new Job with a new one.
const seedCapabilitySlack = 15 * time.Minute

// UNIT_BOUNDARY_DESCRIPTION: the copy Job's one credential for the runner, kept in a Secret of the Job's own name that only its pod mounts. It is minted fresh for every Job the controller creates, never reused across them, and removed with the Job, so a Job's retry after failure carries a capability that has not been seen before. The Agent owns it, so deleting the Agent mid-copy takes it too. It carries no owner label, because a Secret with one is what the platform looks through for a user's credentials.
func (r *AgentReconciler) applySeedCapability(ctx context.Context, agent *apiv1.Agent, owner string) error {
	name, ns := agent.Name, r.config.Namespace
	token, err := r.client.CoreV1().Secrets(ns).Get(ctx, r.runnerName(owner), metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("reading the runner's token to mint a seed capability: %w", err)
	}
	if len(token.Data["token"]) == 0 {
		return fmt.Errorf("the runner's token Secret %s holds no token, so no seed capability can be minted", token.Name)
	}
	expires := time.Now().Add(migrationJobDeadline + seedCapabilitySlack)
	capability, fingerprint, err := vmrunner.NewSeedCapability(string(token.Data["token"]), name, expires)
	if err != nil {
		return err
	}
	desired := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            runtimeMigrationJobName(name),
			Namespace:       ns,
			OwnerReferences: []metav1.OwnerReference{agentOwnerRef(agent)},
			Labels: map[string]string{
				LabelMigrationFor:              name,
				LabelRole:                      RoleRuntimeMigration,
				"agent-platform.ai/managed-by": "platform-controller",
			},
		},
		Data: map[string][]byte{runtimeMigrationCapabilityKey: []byte(capability)},
	}
	secrets := r.client.CoreV1().Secrets(ns)
	existing, err := secrets.Get(ctx, desired.Name, metav1.GetOptions{})
	switch {
	case k8serrors.IsNotFound(err):
		_, err = secrets.Create(ctx, desired, metav1.CreateOptions{})
	case err == nil:
		existing.Data = desired.Data
		_, err = secrets.Update(ctx, existing, metav1.UpdateOptions{})
	}
	if err != nil {
		return fmt.Errorf("storing the seed capability: %w", err)
	}
	slog.Info("runtime migration: seed capability minted", "agent", name, "capability", fingerprint, "expires", expires.UTC().Format(time.RFC3339))
	return nil
}

func (r *AgentReconciler) deleteSeedCapability(ctx context.Context, name string) error {
	err := r.client.CoreV1().Secrets(r.config.Namespace).Delete(ctx, runtimeMigrationJobName(name), metav1.DeleteOptions{})
	if err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("deleting the seed capability: %w", err)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: a copy Job is created only once there is a slot for it, its NetworkPolicy is in place and the runner pod has an address to pin in the Job's pod. The slot count, the attempt and the create run under one lock, so two reconciles cannot both take the last slot, and a copy that waits for one spends no attempt.
func (r *AgentReconciler) startRuntimeMigrationCopy(ctx context.Context, agent *apiv1.Agent, m *runtimeMigration, owner, source string) error {
	name := agent.Name
	if err := ensureMigrationServiceAccount(ctx, r.client, r.config.Namespace); err != nil {
		return err
	}
	if _, err := runtimeMigrationTargetAgent(agent); err != nil {
		return r.noteRuntimeMigration(ctx, agent, m, err)
	}
	runnerIP, err := r.runnerPodIP(ctx, owner)
	if err != nil {
		return err
	}
	if runnerIP == "" {
		return r.setRuntimeMigrationNote(ctx, agent, m, "waiting for the owner's VM runner pod to be ready")
	}
	reader, found, err := r.runtimeMigrationReader(ctx, source)
	if err != nil {
		return err
	}
	if !found {
		return r.setRuntimeMigrationNote(ctx, agent, m, fmt.Sprintf("the volume %s this migration copies from no longer exists", source))
	}
	if err := applyNetworkPolicy(ctx, r.client, buildRuntimeMigrationNetworkPolicy(agent, owner, r.config.Namespace)); err != nil {
		return err
	}
	desired, err := r.buildRuntimeMigrationJob(agent, owner, source, runnerIP, reader)
	if err != nil {
		return err
	}
	r.migrationCopyMu.Lock()
	defer r.migrationCopyMu.Unlock()
	wait, err := r.runtimeMigrationCopySlot(ctx, owner)
	if err != nil {
		return err
	}
	if wait != "" {
		return r.setRuntimeMigrationNote(ctx, agent, m, wait)
	}
	if err := r.applySeedCapability(ctx, agent, owner); err != nil {
		return err
	}
	attempt := m.attempts + 1
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		s.RuntimeMigrationAttempts = attempt
	}); err != nil {
		return err
	}
	m.attempts = attempt
	if _, err := r.client.BatchV1().Jobs(r.config.Namespace).Create(ctx, desired, metav1.CreateOptions{}); err != nil && !k8serrors.IsAlreadyExists(err) {
		return fmt.Errorf("creating the home copy job: %w", err)
	}
	slog.Info("runtime migration: home copy started", "agent", name, "pvc", source, "attempt", attempt)
	return r.setRuntimeMigrationNote(ctx, agent, m, "")
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

// UNIT_BOUNDARY_DESCRIPTION: runs once the Backend has switched: the seed is removed, the home volume the copy was read from is retained for its window, and the migration's records and condition go. Until the switch that volume kept its labels, so an abort could still resume the container on it.
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
	if err := r.deleteSeedCapability(ctx, name); err != nil {
		return err
	}
	until := time.Now().Add(r.migrationRetention())
	if source := agent.Annotations[annRuntimeMigrationSource]; source != "" {
		if err := r.retainMigratedVolume(ctx, agent, source, agentHomeDir, until); err != nil {
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
		annRuntimeMigrationSeed:     nil,
		annRuntimeMigrationEmpty:    nil,
	}); err != nil {
		return err
	}
	if err := r.deleteRuntimeMigrationNetworkPolicy(ctx, name); err != nil {
		return err
	}
	slog.Info("runtime migration: agent moved to the vm backend", "agent", name)
	if err := updateAgentStatus(ctx, r.dynamic, r.config.Namespace, name, func(s *apiv1.AgentStatus) {
		apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionRuntimeMigrating)
		s.RuntimeMigrationAttempts = 0
	}); err != nil {
		return err
	}
	r.migrationEvent(ctx, agent, corev1.EventTypeNormal, "RuntimeMigrationFinished", "the backend switched; the agent now runs on the vm backend")
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: the Job reads the old home volume read-only, as the identity the volume calls for. It runs confined: the runtime's default seccomp profile, no capability beyond the one reading may need, no privilege escalation and a read-only root, under the agent pods' own RuntimeClass, since it only reads. It reaches only the owner's runner, pinned by the runner pod's address in its hosts file so it needs no DNS, with the seed capability minted for it and the CA that signed the runner's serving certificate. It never mounts the runner's token: the Job parses what an agent wrote, and the token would let a Job that did so badly drive every machine of the owner. It runs where the agent's pods run, since that is where its volume attaches.
func (r *AgentReconciler) buildRuntimeMigrationJob(agent *apiv1.Agent, owner, source, runnerIP string, reader runtimeMigrationIdentity) (*batchv1.Job, error) {
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
	// UNIT_BOUNDARY_DESCRIPTION: one attempt per Job, because a capability
	// UNIT_BOUNDARY_DESCRIPTION: seeds once: a second pod of the same Job would
	// UNIT_BOUNDARY_DESCRIPTION: present one its first pod may have spent. A
	// UNIT_BOUNDARY_DESCRIPTION: failed Job is recreated with a fresh one, and
	// UNIT_BOUNDARY_DESCRIPTION: each Job is one of the migration's attempts.
	backoff := int32(0)
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
		"--token-file", runtimeMigrationCredsPath + "/" + runtimeMigrationCapabilityKey,
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
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: runtimeMigrationJobName(name)}, Items: []corev1.KeyToPath{{Key: runtimeMigrationCapabilityKey, Path: runtimeMigrationCapabilityKey}}}},
				{Secret: &corev1.SecretProjection{LocalObjectReference: corev1.LocalObjectReference{Name: r.runnerTLSName(owner)}, Items: []corev1.KeyToPath{{Key: "ca.crt", Path: "ca.crt"}}}},
			},
		}}},
		{Name: "tmp", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{SizeLimit: new(resource.MustParse("16Mi"))}}},
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

// UNIT_BOUNDARY_DESCRIPTION: whether the Agent provably has nothing to copy: its StatefulSet is gone or held at zero, so nothing will make a volume for it any more, and no volume is labelled for it, not even one mid-way through a storage migration.
func (r *AgentReconciler) runtimeMigrationHasNothingToCopy(ctx context.Context, agent *apiv1.Agent) (bool, string, error) {
	name := agent.Name
	ns := r.config.Namespace
	if ss, err := r.client.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{}); err == nil && (ss.Spec.Replicas == nil || *ss.Spec.Replicas > 0) {
		return false, "waiting for the old container statefulset to be scaled to zero", nil
	} else if err != nil && !k8serrors.IsNotFound(err) {
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

const runtimeMigrationNothingToCopy = "this agent never had a volume, so there was nothing to copy; its new machine starts from the image"

// UNIT_BOUNDARY_DESCRIPTION: what the vm side says is keeping the machine from the migration's next step: a runner that is not ready, with the reason the controller found for it, or a machine it failed to create, start or admit. A vm side that could not be ensured says why. A machine that is merely on its way says nothing.
func vmSideProblem(machine vmrunner.MachineStatus, runnerReached bool, vmErr error) string {
	if vmErr != nil {
		return vmErr.Error()
	}
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

// UNIT_BOUNDARY_DESCRIPTION: what makes a booting migration's machine stay down before its first answer, said on the Agent: a stop the user asked for, which is honoured and resumed from on the next start, or an owner budget with no room for the machine.
func runtimeMigrationBootHeld(m runtimeMigration, hardStop bool, overBudget string) string {
	if m.phase != apiv1.ReasonRuntimeMigrationBooting {
		return ""
	}
	switch {
	case hardStop:
		return "the agent was stopped before its new machine first answered; the move goes on when it next starts"
	case overBudget != "":
		return "the new machine is waiting for room in the owner's budget to boot: " + overBudget
	}
	return ""
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

func ownedBy(obj metav1.Object, agent *apiv1.Agent) bool {
	for _, ref := range obj.GetOwnerReferences() {
		if ref.UID == agent.UID && ref.Kind == agentGVK.Kind {
			return true
		}
	}
	return false
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

// UNIT_BOUNDARY_DESCRIPTION: which identity the copy reads the home volume as. A shared volume — one that admits more than one node — may be a share that squashes root, where uid 0 is the weakest identity on the mount and gets EACCES on the agent's own 0600 files, so it is read as the agent's uid, with no capability at all. A volume only one node mounts is a block device that squashes nothing, and its filesystem root holds a root-owned 0700 lost+found the archive walks, which the agent's uid cannot open; it is read as root holding DAC_READ_SEARCH alone, which reads every file and directory and writes nothing.
type runtimeMigrationIdentity struct {
	uid, gid int64
	caps     []corev1.Capability
}

func (r *AgentReconciler) runtimeMigrationReader(ctx context.Context, claim string) (runtimeMigrationIdentity, bool, error) {
	pvc, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Get(ctx, claim, metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		return runtimeMigrationIdentity{}, false, nil
	}
	if err != nil {
		return runtimeMigrationIdentity{}, false, fmt.Errorf("reading the volume %s to copy: %w", claim, err)
	}
	if slices.ContainsFunc(pvc.Spec.AccessModes, func(m corev1.PersistentVolumeAccessMode) bool {
		return m == corev1.ReadWriteMany || m == corev1.ReadOnlyMany
	}) {
		uid, gid := migrationAgentIdentity(r.config)
		return runtimeMigrationIdentity{uid: uid, gid: gid}, true, nil
	}
	return runtimeMigrationIdentity{uid: 0, gid: 0, caps: []corev1.Capability{"DAC_READ_SEARCH"}}, true, nil
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

// UNIT_BOUNDARY_DESCRIPTION: the seed sits on the owner's runner claim from the moment the copy starts until the guest has booted from it, beside the disk it is restored into, so the claim needs room for both at once. The seed is never larger than the home volume it was read from, so that volume's requested size bounds it.
func (r *AgentReconciler) runtimeMigrationSeedBytes(ctx context.Context, agent *apiv1.Agent) int64 {
	switch runtimeMigrationOf(agent.Annotations, agent.Status).phase {
	case apiv1.ReasonRuntimeMigrationCopying, apiv1.ReasonRuntimeMigrationBooting:
	default:
		return 0
	}
	source := agent.Annotations[annRuntimeMigrationSource]
	if source == "" {
		return 0
	}
	pvc, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Get(ctx, source, metav1.GetOptions{})
	if err != nil {
		return 0
	}
	size := pvc.Spec.Resources.Requests[corev1.ResourceStorage]
	return size.Value()
}
