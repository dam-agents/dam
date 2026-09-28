// TEST_OVERVIEW: a runtime migration moves an Agent's home from the volume its container mounted onto the disk of a machine on its owner's runner, and can be undone until that machine has booted from the copy. What must hold at every phase is that the container keeps serving until the machine is proven to exist, nothing runs while the copy is taken, the copy reaches the machine before its first boot, and the old volumes stay the container's own until the Backend has switched — then are retained for a window rather than deleted. A migration that cannot finish stops at a Failed phase with its reason, from which it is aborted or retried.
package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: a container Agent as the api-server leaves it when it requests a migration: its spec untouched, the request and the target shape in annotations.
func migratingAgentCR() *apiv1.Agent {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	agent.Annotations = map[string]string{
		annLastActivity:           time.Now().UTC().Format(time.RFC3339),
		annRuntimeMigration:       runtimeMigrationRequested,
		annRuntimeMigrationTarget: `{"storageSize":"10Gi"}`,
	}
	return agent
}

// UNIT_BOUNDARY_DESCRIPTION: a migrating Agent whose condition already records a phase, as a reconcile after a controller restart receives it.
func migratingAgentIn(phase string, since time.Time) *apiv1.Agent {
	agent := migratingAgentCR()
	status := phase != apiv1.ReasonRuntimeMigrationFailed
	cond := metav1.Condition{Type: apiv1.ConditionRuntimeMigrating, Status: metav1.ConditionFalse, Reason: phase, LastTransitionTime: metav1.NewTime(since)}
	if status {
		cond.Status = metav1.ConditionTrue
	}
	agent.Status.Conditions = []metav1.Condition{cond}
	return agent
}

func homePVC(name string) *corev1.PersistentVolumeClaim {
	return &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{
		Name: name, Namespace: "test-agents",
		Labels: map[string]string{LabelAgent: "my-agent", LabelMount: "home-agent"},
	}}
}

func containerAgentPod() *corev1.Pod {
	return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "my-agent-0", Namespace: "test-agents",
		Labels: map[string]string{LabelAgent: "my-agent", LabelRole: RoleAgent},
	}}
}

// UNIT_BOUNDARY_DESCRIPTION: the Agent as the next reconcile would receive it, with whatever spec, annotations and status the last one wrote.
func reloaded(t *testing.T, r *AgentReconciler, agent *apiv1.Agent) *apiv1.Agent {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), agent.Name, metav1.GetOptions{})
	require.NoError(t, err)
	next := &apiv1.Agent{}
	require.NoError(t, runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, next))
	return next
}

// UNIT_BOUNDARY_DESCRIPTION: what the api-server writes to the stored Agent: the Backend switch after a verified boot, or an abort.
func editStoredAgent(t *testing.T, r *AgentReconciler, agent *apiv1.Agent, edit func(u *unstructured.Unstructured)) *apiv1.Agent {
	t.Helper()
	cli := r.dynamic.Resource(AgentsGVR).Namespace("test-agents")
	u, err := cli.Get(context.Background(), agent.Name, metav1.GetOptions{})
	require.NoError(t, err)
	edit(u)
	_, err = cli.Update(context.Background(), u, metav1.UpdateOptions{})
	require.NoError(t, err)
	return reloaded(t, r, agent)
}

func withoutAnnotations(keys ...string) func(u *unstructured.Unstructured) {
	return func(u *unstructured.Unstructured) {
		ann := u.GetAnnotations()
		for _, k := range keys {
			delete(ann, k)
		}
		u.SetAnnotations(ann)
	}
}

func migrationCondition(agent *apiv1.Agent) *metav1.Condition {
	return apimeta.FindStatusCondition(agent.Status.Conditions, apiv1.ConditionRuntimeMigrating)
}

func requirePhase(t *testing.T, agent *apiv1.Agent, phase string) *metav1.Condition {
	t.Helper()
	c := migrationCondition(agent)
	require.NotNil(t, c, "the migration's condition is on the Agent")
	require.Equal(t, phase, c.Reason, "message: %s", c.Message)
	return c
}

func agentReplicas(t *testing.T, r *AgentReconciler) int32 {
	t.Helper()
	ss, err := r.client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, ss.Spec.Replicas)
	return *ss.Spec.Replicas
}

func completeJob(t *testing.T, r *AgentReconciler, condition batchv1.JobConditionType, created time.Time) {
	t.Helper()
	ctx := context.Background()
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	job.CreationTimestamp = metav1.NewTime(created)
	job.Status.Conditions = []batchv1.JobCondition{{Type: condition, Status: corev1.ConditionTrue}}
	_, err = r.client.BatchV1().Jobs("test-agents").UpdateStatus(ctx, job, metav1.UpdateOptions{})
	require.NoError(t, err)
}

var testSeed = vmrunner.SeedResult{Bytes: 4096, SHA256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}

func testSeedAnnotation(t *testing.T) string {
	t.Helper()
	encoded, err := json.Marshal(testSeed)
	require.NoError(t, err)
	return string(encoded)
}

// UNIT_BOUNDARY_DESCRIPTION: the copy Job finishing as vm-seed does: its pod exits cleanly with the seed the runner stored as its termination message, and the Job completes.
func completeCopy(t *testing.T, r *AgentReconciler, message string) {
	t.Helper()
	ctx := context.Background()
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: job.Name + "-done", Namespace: "test-agents",
			Labels: map[string]string{batchv1.JobNameLabel: job.Name},
		},
		Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
			Name:  "seed",
			State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 0, Message: message}},
		}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	completeJob(t, r, batchv1.JobComplete, time.Now())
}

func createAll(t *testing.T, r *AgentReconciler, objs ...any) {
	t.Helper()
	ctx := context.Background()
	for _, obj := range objs {
		var err error
		switch o := obj.(type) {
		case *corev1.PersistentVolumeClaim:
			_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, o, metav1.CreateOptions{})
		case *corev1.Pod:
			_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, o, metav1.CreateOptions{})
		case *batchv1.Job:
			_, err = r.client.BatchV1().Jobs("test-agents").Create(ctx, o, metav1.CreateOptions{})
		}
		require.NoError(t, err)
	}
}

// TEST_SCENARIO: a migration walks every phase. While the preflight makes the owner's runner and the machine, stopped, the container keeps running and keeps its Service. Only once the machine exists is the container scaled down and its home volume recorded; the Job streams that volume to the runner once the pod is gone, and only then may the machine boot. A guest that answers makes the migration Verified, and that alone changes nothing: the spec is still the container's and the old volume is still its own, until the api-server switches the Backend. Then the StatefulSet and headless Service go, the seed is removed, and the old volume is retained rather than deleted.
func TestARuntimeMigrationPreparesTheMachineBeforeTheContainerStopsAndSwitchesOnlyAfterABoot(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r, homePVC("home-agent-my-agent-0"), containerAgentPod())

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationRequested)
	assert.NotEmpty(t, node.spec("my-agent").Image, "the preflight creates the machine")
	assert.False(t, node.spec("my-agent").Running, "the preflight machine is created stopped")
	assert.Equal(t, int32(1), agentReplicas(t, r), "the container keeps running through the preflight")
	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP, "the agent Service still routes to the container")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationStopping)

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Equal(t, int32(0), agentReplicas(t, r), "the container is stopped once the machine exists")
	assert.Equal(t, "home-agent-my-agent-0", agent.Annotations[annRuntimeMigrationSource], "the volume holding HOME is recorded while it can still be found")
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationStopping)

	require.NoError(t, r.client.CoreV1().Pods("test-agents").Delete(ctx, "my-agent-0", metav1.DeleteOptions{}))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationCopying)

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.False(t, node.spec("my-agent").Running, "the machine stays stopped while its seed is written")
	assert.Equal(t, int32(1), agent.Status.RuntimeMigrationAttempts)
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "a stopped machine gets its home copied")
	pod := job.Spec.Template.Spec
	assert.Equal(t, "quay.io/dam-agents/vm-runner:1", pod.Containers[0].Image, "the copy runs the runner image's own tar writer")
	assert.Contains(t, pod.Containers[0].Command, "https://platform-vm-runner-"+runnerSuffix(testOwner)+".test-agents.svc:4600/machines/my-agent/seed")
	assert.Contains(t, strings.Join(pod.Containers[0].Command, " "), "--map-owner 65532:65532:0", "the container's agent becomes the machine's root")
	assert.Equal(t, "home-agent-my-agent-0", pod.Volumes[0].PersistentVolumeClaim.ClaimName)
	assert.True(t, pod.Volumes[0].PersistentVolumeClaim.ReadOnly, "the copy never writes to the volume it copies")
	assert.Equal(t, RoleRuntimeMigration, job.Spec.Template.Labels[LabelRole])
	assert.Equal(t, testOwner, job.Spec.Template.Labels[envoyOwnerLabel], "the runner admits the Job by its owner, so it reaches no one else's runner")
	assert.Contains(t, strings.Join(pod.Containers[0].Command, " "), "--result-file /dev/termination-log", "the copy says which seed it stored")

	completeCopy(t, r, testSeedAnnotation(t))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationBooting)
	assert.JSONEq(t, testSeedAnnotation(t), agent.Annotations[annRuntimeMigrationSeed], "the seed the runner stored is what the boot is held to")

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.True(t, node.spec("my-agent").Running, "the copied machine boots, even if the agent had been asleep")
	assert.Equal(t, int32(0), agentReplicas(t, r), "the container stays down while the machine holds the home")
	assert.Equal(t, &testSeed, node.spec("my-agent").ExpectSeed, "the runner is told which seed the home must come from")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true, HomeSeededFrom: testSeed.SHA256})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationVerified)
	assert.False(t, agent.Spec.IsVM(), "the controller never writes the spec")
	assert.Empty(t, node.seedGone, "the seed stays until the Backend has switched")
	old, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", old.Labels[LabelAgent], "the old volume is still the container's until the switch")

	agent = editStoredAgent(t, r, agent, func(u *unstructured.Unstructured) {
		require.NoError(t, unstructured.SetNestedField(u.Object, "vm", "spec", "backend", "type"))
		withoutAnnotations(annRuntimeMigration, annRuntimeMigrationTarget)(u)
	})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Nil(t, migrationCondition(agent), "the migration is over")
	assert.Zero(t, agent.Status.RuntimeMigrationAttempts)
	assert.NotContains(t, agent.Annotations, annRuntimeMigrationSource)
	assert.NotContains(t, agent.Annotations, annRuntimeMigrationSeed)
	assert.Nil(t, node.spec("my-agent").ExpectSeed, "a machine past its boot expects no seed any more")
	assert.Equal(t, []string{"my-agent"}, node.seedGone, "the staged seed goes once the Backend has switched")
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the container StatefulSet is removed after the switch")
	svc, err = r.client.CoreV1().Services("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEqual(t, corev1.ClusterIPNone, svc.Spec.ClusterIP, "the machine's Service replaces the headless one")
	old, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err, "the old volume is retained, not deleted")
	assertRetained(t, old, "/home/agent", time.Now().Add(defaultMigrationRetention))
}

// TEST_SCENARIO: the machine is shaped as the request's target, not as the container: it runs the Agent's image with the disk the api-server sized for every copied volume, and a request from before the machine exists is shown the preflight's own reason when the runner cannot make it.
func TestThePreflightMachineTakesTheTargetShapeAndReportsWhyItIsNotReady(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	agent.Annotations[annRuntimeMigrationTarget] = `{"storageSize":"25Gi"}`
	r, node, _ := setupVMReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonImageUnavailable, Message: "pulling ghcr.io/myorg/agent:latest was denied"})

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationRequested)
	assert.Equal(t, "pulling ghcr.io/myorg/agent:latest was denied", c.Message)
	assert.Equal(t, "ghcr.io/myorg/agent:latest", node.spec("my-agent").Image)
	assert.Equal(t, 25, node.spec("my-agent").StorageGiB)
	assert.Equal(t, int32(1), agentReplicas(t, r), "a preflight that cannot pass leaves the container serving")
}

// TEST_SCENARIO: an abort before the verified boot removes what the vm side made — the copy Job, the machine with its seed, the record of the source volume and the condition — and the container comes back on the volumes it had, which never lost their labels.
func TestAnAbortRemovesTheVMSideAndTheContainerResumes(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationCopying, time.Now())
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r, homePVC("home-agent-my-agent-0"))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	_, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), agentReplicas(t, r))

	agent = editStoredAgent(t, r, agent, withoutAnnotations(annRuntimeMigration, annRuntimeMigrationTarget))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Nil(t, migrationCondition(agent))
	assert.NotContains(t, agent.Annotations, annRuntimeMigrationSource)
	assert.Contains(t, node.deleted, "my-agent", "the machine and its seed are removed")
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the copy Job is removed")
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", pvc.Labels[LabelAgent], "the old volume is left as it was")

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentReplicas(t, r), "the container runs again")
}

// TEST_SCENARIO: a guest that answers is verified only while the request still stands. An abort that the reconcile did not see yet — the Agent it holds is older than the stored one — wins, and the migration is not marked past its point of no return.
func TestAVerifiedBootIsNotRecordedOverAnAbort(t *testing.T) {
	ctx := context.Background()
	agent := bootingAgentCR(t)
	r, node, _ := setupVMReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true, HomeSeededFrom: testSeed.SHA256})
	editStoredAgent(t, r, agent, withoutAnnotations(annRuntimeMigration))

	require.NoError(t, r.Reconcile(ctx, agent))
	requirePhase(t, reloaded(t, r, agent), apiv1.ReasonRuntimeMigrationBooting)
}

// TEST_SCENARIO: a copy that fails is reported and retried, and the machine is never booted from the image instead — that would seed a fresh home and the copy could never land. Each Job is one counted attempt.
func TestAFailedHomeCopyIsReportedAndRetriedWithoutBooting(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationCopying, time.Now())
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r, homePVC("home-agent-my-agent-0"))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)

	completeJob(t, r, batchv1.JobFailed, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationCopying)
	assert.Contains(t, c.Message, "retrying (attempt 1 of 3)", "the user is told the copy is stuck")
	assert.False(t, node.spec("my-agent").Running)
	_, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "a fresh failure is kept for its logs until the retry delay passes")

	completeJob(t, r, batchv1.JobFailed, time.Now().Add(-2*migrationJobRetryAfter))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "an old failure is cleared so the next reconcile copies again")
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(2), reloaded(t, r, agent).Status.RuntimeMigrationAttempts)
}

// TEST_SCENARIO: the copy is bounded. Once its attempts are spent the migration is Failed, with the last attempt's reason, rather than retrying forever; the container stays down, since it was stopped for the copy, until the user acts. A retry the user asks for after the failure starts over from the preflight with a fresh machine and its attempts reset, and the container serves again meanwhile.
func TestACopyOutOfAttemptsFailsAndARetryStartsOver(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationCopying, time.Now())
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	agent.Status.RuntimeMigrationAttempts = runtimeMigrationMaxAttempts
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r, homePVC("home-agent-my-agent-0"))
	createAll(t, r, &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: runtimeMigrationJobName("my-agent"), Namespace: "test-agents", OwnerReferences: []metav1.OwnerReference{agentOwnerRef(agent)}}})
	completeJob(t, r, batchv1.JobFailed, time.Now().Add(-2*migrationJobRetryAfter))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationFailed)
	assert.Equal(t, metav1.ConditionFalse, c.Status)
	assert.Contains(t, c.Message, "gave up after 3 attempts")
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationFailed)
	assert.Equal(t, int32(0), agentReplicas(t, r), "a failed migration keeps the stopped container stopped")
	assert.False(t, node.spec("my-agent").Running)
	assert.NotContains(t, node.deleted, "my-agent", "a failure alone removes nothing")

	failedAt := migrationCondition(agent).LastTransitionTime.Time
	agent = editStoredAgent(t, r, agent, func(u *unstructured.Unstructured) {
		ann := u.GetAnnotations()
		ann[annRuntimeMigrationRetry] = failedAt.Add(time.Second).UTC().Format(time.RFC3339)
		u.SetAnnotations(ann)
	})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationRequested)
	assert.Zero(t, agent.Status.RuntimeMigrationAttempts)
	assert.NotContains(t, agent.Annotations, annRuntimeMigrationSource)
	assert.Contains(t, node.deleted, "my-agent", "a retry starts from a fresh machine")
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentReplicas(t, r), "the container serves through the new preflight")
}

// TEST_SCENARIO: a migration is also bounded in time. One that has not got past its preflight within the budget is Failed with the reason it was waiting on, and since the container was never stopped it keeps serving.
func TestAMigrationPastItsTimeBudgetFails(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationRequested, time.Now().Add(-runtimeMigrationBudget-time.Minute))
	agent.Status.Conditions[0].Message = "the owner's VM runner pod cannot be scheduled"
	r, _, _ := setupVMReconciler(t, agent)

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationFailed)
	assert.Contains(t, c.Message, "did not finish within 6h0m0s")
	assert.Contains(t, c.Message, "cannot be scheduled")
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), agentReplicas(t, r), "a preflight failure never stopped the container")
}

func assertRetained(t *testing.T, pvc *corev1.PersistentVolumeClaim, mount string, until time.Time) {
	t.Helper()
	assert.Equal(t, "my-agent", pvc.Labels[LabelRetainedFor])
	for _, gone := range []string{LabelAgent, LabelMount, LabelPool, LabelPoolAvailable} {
		assert.NotContains(t, pvc.Labels, gone, "a retained volume is invisible to everything that finds an agent's volumes by label")
	}
	assert.Equal(t, mount, pvc.Annotations[annRetainedMount])
	kept, err := time.Parse(time.RFC3339, pvc.Annotations[annRetainedUntil])
	require.NoError(t, err)
	assert.WithinDuration(t, until, kept, time.Minute)
	require.Len(t, pvc.OwnerReferences, 1, "the retained volume goes with the Agent")
	assert.Equal(t, "my-agent", pvc.OwnerReferences[0].Name)
}

func retainedPVC(name, until string) *corev1.PersistentVolumeClaim {
	return &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{
		Name: name, Namespace: "test-agents",
		Labels:      map[string]string{LabelRetainedFor: "my-agent"},
		Annotations: map[string]string{annRetainedUntil: until, annRetainedMount: "/home/agent"},
	}}
}

// TEST_SCENARIO: the retention window is the install's to set, and a finish that is retried — its annotation patch failed after the volume was marked — keeps the window the first attempt gave rather than starting a new one.
func TestTheRetentionWindowIsConfiguredAndNotExtendedByARetry(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	agent.Annotations[annRuntimeMigration] = runtimeMigrationBooting
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.RuntimeMigration.Retention = config.Duration(48 * time.Hour)
	pvc := homePVC("home-agent-my-agent-0")
	pvc.Labels[LabelPool] = "10gi"
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, pvc, metav1.CreateOptions{})
	require.NoError(t, err)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})

	require.NoError(t, r.finishRuntimeMigration(ctx, agent))
	first, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assertRetained(t, first, "/home/agent", time.Now().Add(48*time.Hour))

	r.config.VM.RuntimeMigration.Retention = config.Duration(time.Hour)
	require.NoError(t, r.finishRuntimeMigration(ctx, agent))
	again, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, first.Annotations[annRetainedUntil], again.Annotations[annRetainedUntil])
	assert.Len(t, again.OwnerReferences, 1)
}

// TEST_SCENARIO: the sweep ends retention. A volume past its window goes, and so does one whose Agent is gone; one inside its window stays, and so does one whose window an operator edited into something that is not a time, since deleting the only copy of an agent's old work on a typo cannot be undone.
func TestTheSweepDeletesRetainedVolumesPastTheirWindowOrAgent(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	past := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	orphan := retainedPVC("orphaned", future)
	orphan.Labels[LabelRetainedFor] = "deleted-agent"
	for _, p := range []*corev1.PersistentVolumeClaim{retainedPVC("expired", past), retainedPVC("kept", future), retainedPVC("typo", "next tuesday"), orphan} {
		_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, p, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	r.ReconcileRetainedVolumes(ctx)

	for name, kept := range map[string]bool{"expired": false, "orphaned": false, "kept": true, "typo": true} {
		_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, name, metav1.GetOptions{})
		if kept {
			assert.NoError(t, err, name)
		} else {
			assert.True(t, k8serrors.IsNotFound(err), name)
		}
	}
}

// TEST_SCENARIO: deleting the Agent deletes what is retained for it along with its own volumes, and leaves another agent's retained volume alone.
func TestDeletingTheAgentDeletesItsRetainedVolumes(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	other := retainedPVC("other", time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
	other.Labels[LabelRetainedFor] = "other-agent"
	for _, p := range []*corev1.PersistentVolumeClaim{retainedPVC("mine", time.Now().Add(time.Hour).UTC().Format(time.RFC3339)), other} {
		_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, p, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	r.deletePVCs(ctx, "my-agent")

	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "mine", metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err))
	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "other", metav1.GetOptions{})
	assert.NoError(t, err)
}

// TEST_SCENARIO: a StatefulSet claims volumes by name, so an Agent put back on the container backend by hand would mount the retained home of the same name and resume from before its move. Its StatefulSet is not created while anything is retained for it, and the error says what to do.
func TestAContainerAgentIsNotStartedOverItsRetainedVolume(t *testing.T) {
	ctx := context.Background()
	agent := agentCR()
	r, _ := setupReconciler(t, agent)
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, retainedPVC("home-agent-my-agent-0", time.Now().Add(time.Hour).UTC().Format(time.RFC3339)), metav1.CreateOptions{})
	require.NoError(t, err)

	_, err = r.resolveWorkspaceClaims(ctx, agent, &agent.Spec)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "home-agent-my-agent-0")
	assert.Contains(t, err.Error(), "recover or delete")
}

// TEST_SCENARIO: a failed copy names why. The last attempt's own error — vm-seed's error and its causes, carried as the pod's termination message — is shown with the retry, and an earlier attempt's older error is not.
func TestAFailedHomeCopySaysWhyItsLastAttemptFailed(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationCopying, time.Now())
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r, homePVC("home-agent-my-agent-0"))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.TerminationMessageFallbackToLogsOnError, job.Spec.Template.Spec.Containers[0].TerminationMessagePolicy)
	now := time.Now()
	for i, attempt := range []struct {
		finished time.Time
		message  string
	}{
		{now.Add(-time.Minute), "Error: an older failure"},
		{now, "{\"level\":\"INFO\",\"message\":\"seed upload starting\"}\nError: uploading the seed to https://runner:4600/machines/my-agent/seed\n\nCaused by:\n    0: error sending request\n    1: Connection refused (os error 111)\n"},
	} {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name: fmt.Sprintf("%s-%d", job.Name, i), Namespace: "test-agents",
				Labels: map[string]string{batchv1.JobNameLabel: job.Name},
			},
			Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
				Name: "seed",
				State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
					ExitCode: 1, FinishedAt: metav1.NewTime(attempt.finished), Message: attempt.message,
				}},
			}}},
		}
		_, err := r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	completeJob(t, r, batchv1.JobFailed, now)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t,
		"copying the home directory failed (Error: uploading the seed to https://runner:4600/machines/my-agent/seed; 0: error sending request; 1: Connection refused (os error 111)); retrying (attempt 1 of 3)",
		migrationCondition(reloaded(t, r, agent)).Message)
}

// TEST_SCENARIO: an agent created and never woken has no volume at all, so once its StatefulSet is held at zero there is provably nothing to copy. The copy step ends at once: the migration goes straight to `Booting`, with a message that says so, and its machine is held to no seed and starts from the image. A guest that answers with the image's home is the verified boot, and the switch follows as for any migration.
func TestAMigrationWithNothingToCopyBootsFromTheImage(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationStopping, time.Now())
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationBooting)
	assert.Equal(t, runtimeMigrationNothingToCopy, c.Message)
	assert.Equal(t, "true", agent.Annotations[annRuntimeMigrationEmpty])

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.True(t, node.spec("my-agent").Running, "the machine boots without a seed")
	assert.Nil(t, node.spec("my-agent").ExpectSeed, "and is held to none")
	_, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "there is nothing to copy, so no copy runs")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.NoError(t, r.Reconcile(ctx, agent))
	requirePhase(t, reloaded(t, r, agent), apiv1.ReasonRuntimeMigrationVerified)
}

// TEST_SCENARIO: a volume without a home is not "nothing to copy": the migration waits in `Stopping` and says why, rather than boot a machine that silently starts from the image.
func TestAMigrationWithAVolumeButNoHomeWaits(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationStopping, time.Now())
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r, mountPVC("data-my-agent-0", "/data"))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationStopping)
	assert.Contains(t, c.Message, "no volume holds this agent's home")
	assert.False(t, node.spec("my-agent").Running)
}

// TEST_SCENARIO: which side may run in each phase. The preflight leaves the container serving; from the moment it stops until the copy has landed nothing runs; from `Booting` the machine runs and the container stays down; a failure keeps the container down only if the migration had already stopped it. A request from the previous controller, which kept its phase in the request itself, resumes in that phase.
func TestEachPhaseSaysWhichSideRuns(t *testing.T) {
	for _, tc := range []struct {
		phase                          string
		source                         bool
		holdsDown, containerDown, vmUp bool
	}{
		{apiv1.ReasonRuntimeMigrationRequested, false, false, false, false},
		{apiv1.ReasonRuntimeMigrationStopping, false, true, true, false},
		{apiv1.ReasonRuntimeMigrationCopying, true, true, true, false},
		{apiv1.ReasonRuntimeMigrationBooting, true, false, true, true},
		{apiv1.ReasonRuntimeMigrationVerified, true, false, true, true},
		{apiv1.ReasonRuntimeMigrationFailed, false, false, false, false},
		{apiv1.ReasonRuntimeMigrationFailed, true, true, true, false},
	} {
		agent := migratingAgentIn(tc.phase, time.Now())
		if tc.source {
			agent.Annotations[annRuntimeMigrationSource] = "home"
			agent.Annotations[annRuntimeMigrationSeed] = testSeedAnnotation(t)
		}
		m := runtimeMigrationOf(agent.Annotations, agent.Status)
		assert.Equal(t, tc.holdsDown, m.holdsDown(), "%s (source %v) holds the agent down", tc.phase, tc.source)
		assert.Equal(t, tc.containerDown, m.containerDown(), "%s (source %v) keeps the container down", tc.phase, tc.source)
		assert.Equal(t, tc.vmUp, m.machineMayRun(), "%s (source %v) lets the machine run", tc.phase, tc.source)
	}
	for legacy, phase := range map[string]string{
		runtimeMigrationRequested: apiv1.ReasonRuntimeMigrationRequested,
		runtimeMigrationCopying:   apiv1.ReasonRuntimeMigrationCopying,
		runtimeMigrationBooting:   apiv1.ReasonRuntimeMigrationBooting,
	} {
		m := runtimeMigrationOf(map[string]string{annRuntimeMigration: legacy}, apiv1.AgentStatus{})
		assert.Equal(t, phase, m.phase, legacy)
	}
	assert.False(t, runtimeMigrationOf(nil, apiv1.AgentStatus{}).active())
}

// TEST_SCENARIO: an Agent that persisted paths besides HOME on the container backend brings them along. The api-server said where each path went and gave the machine the rewritten mounts; the controller finds each path's volume while the pod is going, mounts it read-only beside the home in the copy Job and names where it goes below HOME, and after the switch retains it with the home, each marked with the path it held. A path no volume was ever made for has nothing to carry, but it is still in the machine's links plan, which the target shape carries as each moved mount's movedFrom, since the agent's software still looks there. The plan comes from the spec, not the seed, so the copy Job carries none.
func TestAMigrationCarriesTheAgentsOtherPersistedVolumes(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationStopping, time.Now())
	agent.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/data", Persist: true},
		{Path: "/home/agent/cache", Persist: true},
		{Path: "/never", Persist: true},
	}
	agent.Annotations[annRuntimeMigrationTarget] = `{"mounts":[{"path":"/home/agent","persist":true},{"path":"/home/agent/.persisted/data","persist":true,"movedFrom":"/data"},{"path":"/home/agent/cache","persist":true},{"path":"/home/agent/.persisted/never","persist":true,"movedFrom":"/never"}],"storageSize":"40Gi"}`
	agent.Annotations[annRuntimeMigrationMounts] = `{"/data":"/home/agent/.persisted/data","/home/agent/cache":"/home/agent/cache","/never":"/home/agent/.persisted/never"}`
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r,
		homePVC("home-agent-my-agent-0"),
		mountPVC("data-my-agent-0", "/data"),
		mountPVC("home-agent-cache-my-agent-0", "/home/agent/cache"),
	)

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationCopying)
	grafts, err := recordedGrafts(agent)
	require.NoError(t, err)
	assert.Equal(t, []runtimeMigrationGraft{
		{From: "/data", At: ".persisted/data", PVC: "data-my-agent-0"},
		{From: "/home/agent/cache", At: "cache", PVC: "home-agent-cache-my-agent-0"},
	}, grafts)
	assert.Equal(t, 40, node.spec("my-agent").StorageGiB, "the machine's disk is the size the request gave it")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	pod := job.Spec.Template.Spec
	command := pod.Containers[0].Command
	assert.Contains(t, strings.Join(command, " "), "--graft .persisted/data=/mnt/extra/0 --graft cache=/mnt/extra/1")
	assert.NotContains(t, strings.Join(command, " "), "--links", "the seed carries no plan and nothing to run")
	assert.Equal(t, []string{"/data", "/never"}, node.spec("my-agent").Links,
		"the machine built beside the container takes its links plan from the target shape: every path moved from outside HOME, even one no volume was made for; one under HOME keeps its place and needs no link")
	claims := map[string]string{}
	for _, v := range pod.Volumes {
		if v.PersistentVolumeClaim != nil {
			assert.True(t, v.PersistentVolumeClaim.ReadOnly, "the copy never writes to a volume it copies")
			claims[v.Name] = v.PersistentVolumeClaim.ClaimName
		}
	}
	assert.Equal(t, map[string]string{"home": "home-agent-my-agent-0", "extra-0": "data-my-agent-0", "extra-1": "home-agent-cache-my-agent-0"}, claims)

	completeCopy(t, r, testSeedAnnotation(t))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true, HomeSeededFrom: testSeed.SHA256})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationVerified)
	agent = editStoredAgent(t, r, agent, func(u *unstructured.Unstructured) {
		require.NoError(t, unstructured.SetNestedField(u.Object, "vm", "spec", "backend", "type"))
		require.NoError(t, unstructured.SetNestedSlice(u.Object, []any{
			map[string]any{"path": "/home/agent", "persist": true},
			map[string]any{"path": "/home/agent/.persisted/data", "persist": true, "movedFrom": "/data"},
			map[string]any{"path": "/home/agent/cache", "persist": true},
			map[string]any{"path": "/home/agent/.persisted/never", "persist": true, "movedFrom": "/never"},
		}, "spec", "mounts"))
		withoutAnnotations(annRuntimeMigration, annRuntimeMigrationTarget, annRuntimeMigrationMounts)(u)
	})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	for _, key := range []string{annRuntimeMigration, annRuntimeMigrationMounts, annRuntimeMigrationGrafts} {
		assert.NotContains(t, agent.Annotations, key)
	}
	for name, mount := range map[string]string{"home-agent-my-agent-0": "/home/agent", "data-my-agent-0": "/data", "home-agent-cache-my-agent-0": "/home/agent/cache"} {
		pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err, name)
		assertRetained(t, pvc, mount, time.Now().Add(defaultMigrationRetention))
	}
}

// TEST_SCENARIO: a boot is held to the seed the copy stored, so a booting migration with no readable record of that seed — one that entered booting before the seed was recorded, or a record edited into something else — is not let run: a machine booted without the expectation could seed its home from the image.
func TestABootWithNoRecordedSeedIsHeldDown(t *testing.T) {
	for _, recorded := range []string{"", "not json", `{"bytes":0,"sha256":""}`, `{"bytes":4,"sha256":"ABC"}`} {
		agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationBooting, time.Now())
		if recorded != "" {
			agent.Annotations[annRuntimeMigrationSeed] = recorded
		}
		m := runtimeMigrationOf(agent.Annotations, agent.Status)
		assert.True(t, m.holdsDown(), "seed %q", recorded)
		assert.False(t, m.machineMayRun(), "seed %q", recorded)
		assert.Nil(t, runtimeMigrationExpectSeed(agent), "seed %q", recorded)
	}
	agent := bootingAgentCR(t)
	assert.Equal(t, &testSeed, runtimeMigrationExpectSeed(agent), "a recorded seed is expected while booting")
	verified := migratingAgentIn(apiv1.ReasonRuntimeMigrationVerified, time.Now())
	verified.Annotations[annRuntimeMigrationSeed] = testSeedAnnotation(t)
	assert.Nil(t, runtimeMigrationExpectSeed(verified), "a verified machine is past the boot the seed was for")
}

func bootingAgentCR(t *testing.T) *apiv1.Agent {
	agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationBooting, time.Now())
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	agent.Annotations[annRuntimeMigrationSeed] = testSeedAnnotation(t)
	agent.Status.RuntimeMigrationAttempts = 1
	return agent
}

// TEST_SCENARIO: the seed can go missing between the copy and the boot — a lost runner claim, a crash, an operator — and the runner then refuses to start the machine rather than boot the image's home. The controller does not wait on a boot that cannot succeed: it deletes the machine and goes back to copying, which is safe because the old volume keeps its labels until the switch, and it says why.
func TestABootWhoseSeedTheRunnerLostCopiesTheHomeAgain(t *testing.T) {
	ctx := context.Background()
	agent := bootingAgentCR(t)
	r, node, _ := setupVMReconciler(t, agent)
	createAll(t, r, homePVC("home-agent-my-agent-0"))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000, Reason: vmrunner.ReasonSeedMissing, Message: "the runner holds no seed for it"})

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationCopying)
	assert.Contains(t, c.Message, "the runner holds no seed for it")
	assert.NotContains(t, agent.Annotations, annRuntimeMigrationSeed)
	assert.Equal(t, []string{"my-agent"}, node.deleted, "the machine is made again, so the new copy lands on a fresh disk")
	assert.Empty(t, node.seedGone)
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", pvc.Labels[LabelAgent], "the old volume is not retained, so the next copy still finds it")
}

// TEST_SCENARIO: a guest that answers proves only that it booted, not that its home is the copy. When the runner does not report the expected seed as the one the home came from — the image's home, or another seed — the migration is not verified, so the Backend is never switched and nothing is retained; the home is copied again onto a fresh machine.
func TestAGuestWhoseHomeIsNotTheCopyIsNotVerified(t *testing.T) {
	for _, from := range []string{"", strings.Repeat("0", 64)} {
		ctx := context.Background()
		agent := bootingAgentCR(t)
		r, node, _ := setupVMReconciler(t, agent)
		createAll(t, r, homePVC("home-agent-my-agent-0"))
		node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true, HomeSeededFrom: from})

		require.NoError(t, r.Reconcile(ctx, agent))
		agent = reloaded(t, r, agent)
		c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationCopying)
		assert.Contains(t, c.Message, testSeed.SHA256, "from %q", from)
		assert.False(t, agent.Spec.IsVM())
		assert.Equal(t, "home-agent-my-agent-0", agent.Annotations[annRuntimeMigrationSource], "the migration keeps what it copies from")
		assert.Empty(t, node.seedGone, "the seed is not deleted by a boot that did not use it")
		assert.Equal(t, []string{"my-agent"}, node.deleted)
		pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
		require.NoError(t, err)
		assert.NotContains(t, pvc.Labels, LabelRetainedFor)
	}
}

// TEST_SCENARIO: a boot that keeps failing the seed match counts against the migration's attempts like a failing copy, so it ends Failed rather than copying again forever.
func TestABootThatKeepsMissingTheSeedFails(t *testing.T) {
	ctx := context.Background()
	agent := bootingAgentCR(t)
	agent.Status.RuntimeMigrationAttempts = runtimeMigrationMaxAttempts
	r, node, _ := setupVMReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	requirePhase(t, agent, apiv1.ReasonRuntimeMigrationCopying)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationFailed)
	assert.Contains(t, c.Message, "not from the copy")
}

// TEST_SCENARIO: a copy Job that completed without saying which seed it stored — its pod already gone, or a message that is not a seed — gives the boot nothing to be held to. The home is copied again rather than booted unchecked.
func TestACopyThatDoesNotSayWhichSeedItStoredIsMadeAgain(t *testing.T) {
	for _, message := range []string{"", "not a seed", `{"bytes":0,"sha256":""}`} {
		ctx := context.Background()
		agent := migratingAgentIn(apiv1.ReasonRuntimeMigrationCopying, time.Now())
		agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
		r, node, _ := setupVMReconciler(t, agent)
		createAll(t, r, homePVC("home-agent-my-agent-0"))
		node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
		require.NoError(t, r.Reconcile(ctx, agent))
		agent = reloaded(t, r, agent)
		if message == "" {
			completeJob(t, r, batchv1.JobComplete, time.Now())
		} else {
			completeCopy(t, r, message)
		}

		require.NoError(t, r.Reconcile(ctx, agent))
		agent = reloaded(t, r, agent)
		c := requirePhase(t, agent, apiv1.ReasonRuntimeMigrationCopying)
		assert.Contains(t, c.Message, "copying it again", "message %q", message)
		assert.NotContains(t, agent.Annotations, annRuntimeMigrationSeed)
		_, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
		assert.True(t, k8serrors.IsNotFound(err), "the copy is made again")
		assert.False(t, node.spec("my-agent").Running)
	}
}

// TEST_SCENARIO: an abort drops the record of the seed with the rest of the migration, so a later request never holds a boot to a copy from before.
func TestAnAbortClearsTheRecordedSeed(t *testing.T) {
	ctx := context.Background()
	agent := bootingAgentCR(t)
	r, _, _ := setupVMReconciler(t, agent)
	agent = editStoredAgent(t, r, agent, withoutAnnotations(annRuntimeMigration, annRuntimeMigrationTarget))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Nil(t, migrationCondition(agent))
	assert.NotContains(t, agent.Annotations, annRuntimeMigrationSeed)
}

// TEST_SCENARIO: the owner's runner admits its own migration Jobs to the machine API and nothing else new: not the published agent ports, and not a Job of another owner.
func TestTheRunnerAdmitsItsOwnersMigrationJobToTheMachineAPIOnly(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "default", 10000, nil, nil, nil)
	var found bool
	for _, rule := range np.Spec.Ingress {
		for _, peer := range rule.From {
			if peer.PodSelector == nil || peer.PodSelector.MatchLabels[LabelRole] != RoleRuntimeMigration {
				continue
			}
			found = true
			assert.Nil(t, peer.NamespaceSelector, "the Job runs in the agent namespace, beside the runner")
			assert.Equal(t, testOwner, peer.PodSelector.MatchLabels[envoyOwnerLabel])
			require.Len(t, rule.Ports, 1)
			assert.Equal(t, int32(vmRunnerPort), rule.Ports[0].Port.IntVal)
			assert.Nil(t, rule.Ports[0].EndPort)
		}
	}
	assert.True(t, found)
}

func mountPVC(name, path string) *corev1.PersistentVolumeClaim {
	return &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{
		Name: name, Namespace: "test-agents",
		Labels: map[string]string{LabelAgent: "my-agent", LabelMount: sanitizeMountName(path)},
	}}
}

// TEST_SCENARIO: the seed maps the agent's container ids to the machine's root, so they are read from the install's agent security context: an install that runs its agents as another uid and gid gets those mapped, and one that sets neither falls back to the chart's 65532 as the storage migration does.
func TestRuntimeMigrationOwnerMapFollowsTheAgentSecurityContext(t *testing.T) {
	uid, gid := int64(1000), int64(2000)
	custom := &config.Config{AgentBase: config.AgentBase{ContainerSecurityContext: &corev1.SecurityContext{RunAsUser: &uid, RunAsGroup: &gid}}}
	assert.Equal(t, "1000:2000:0", runtimeMigrationOwnerMap(custom))
	assert.Equal(t, "65532:65532:0", runtimeMigrationOwnerMap(&config.Config{}))
}
