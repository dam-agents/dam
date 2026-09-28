// TEST_OVERVIEW: a runtime migration moves an Agent's home from the volume its container mounted onto the disk of a machine on its owner's runner. What must hold at every phase is that nothing runs while the copy is taken, the copy reaches the machine before its first boot, and the old volume outlives the migration until the new guest has answered and for a retention window after — so a failure anywhere, even one found after the move, leaves the agent's work where it was.
package reconciler

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func migratingAgentCR() *apiv1.Agent {
	agent := vmAgentCR()
	agent.Annotations[annRuntimeMigration] = runtimeMigrationRequested
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

// UNIT_BOUNDARY_DESCRIPTION: the Agent as the next reconcile would receive it, carrying whatever annotations the last one patched.
func reloaded(t *testing.T, r *AgentReconciler, agent *apiv1.Agent) *apiv1.Agent {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), agent.Name, metav1.GetOptions{})
	require.NoError(t, err)
	next := agent.DeepCopy()
	next.Annotations = u.GetAnnotations()
	return next
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

// TEST_SCENARIO: a migration walks every phase: the old pod is waited out and its StatefulSet and headless Service removed, the machine is created and left stopped while a Job streams the home volume to the owner's runner, and only once that Job has finished is the machine allowed to boot. The staged seed is removed after the guest answers, and not a reconcile sooner, and the old volume is then retained rather than deleted.
func TestARuntimeMigrationCopiesTheHomeBeforeTheMachineFirstBoots(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	for _, obj := range []any{homePVC("home-agent-my-agent-0"), containerAgentPod()} {
		switch o := obj.(type) {
		case *corev1.PersistentVolumeClaim:
			_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, o, metav1.CreateOptions{})
			require.NoError(t, err)
		case *corev1.Pod:
			_, err := r.client.CoreV1().Pods("test-agents").Create(ctx, o, metav1.CreateOptions{})
			require.NoError(t, err)
		}
	}
	_, err := r.client.AppsV1().StatefulSets("test-agents").Create(ctx, &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "my-agent", Namespace: "test-agents"}}, metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Services("test-agents").Create(ctx, &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "my-agent", Namespace: "test-agents"},
		Spec:       corev1.ServiceSpec{ClusterIP: corev1.ClusterIPNone},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Equal(t, runtimeMigrationRequested, agent.Annotations[annRuntimeMigration], "the old pod is still there, so nothing moves on")
	assert.Equal(t, "home-agent-my-agent-0", agent.Annotations[annRuntimeMigrationSource], "the volume holding HOME is recorded while it can still be found")
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the container StatefulSet is removed")
	assert.False(t, node.spec("my-agent").Running, "nothing boots while the old pod may still write to the volume")

	require.NoError(t, r.client.CoreV1().Pods("test-agents").Delete(ctx, "my-agent-0", metav1.DeleteOptions{}))
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	require.Equal(t, runtimeMigrationCopying, agent.Annotations[annRuntimeMigration])

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.False(t, node.spec("my-agent").Running, "the machine stays stopped while its seed is written")
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "a stopped machine gets its home copied")
	pod := job.Spec.Template.Spec
	assert.Equal(t, "quay.io/dam-agents/vm-runner:1", pod.Containers[0].Image, "the copy runs the runner image's own tar writer")
	assert.Contains(t, pod.Containers[0].Command, "https://platform-vm-runner-"+runnerSuffix(testOwner)+".test-agents.svc:4600/machines/my-agent/seed")
	assert.Equal(t, "home-agent-my-agent-0", pod.Volumes[0].PersistentVolumeClaim.ClaimName)
	assert.True(t, pod.Volumes[0].PersistentVolumeClaim.ReadOnly, "the copy never writes to the volume it copies")
	assert.Equal(t, RoleRuntimeMigration, job.Spec.Template.Labels[LabelRole])
	assert.Equal(t, testOwner, job.Spec.Template.Labels[envoyOwnerLabel], "the runner admits the Job by its owner, so it reaches no one else's runner")

	completeJob(t, r, batchv1.JobComplete, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	require.Equal(t, runtimeMigrationBooting, agent.Annotations[annRuntimeMigration])
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a finished copy is cleaned up")

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.True(t, node.spec("my-agent").Running, "the copied machine boots, even if the agent had been asleep")
	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err, "the old volume is kept until the new guest has answered")
	assert.Empty(t, node.seedGone)

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	for _, key := range []string{annRuntimeMigration, annRuntimeMigrationSource, annRuntimeMigrationMessage} {
		assert.NotContains(t, agent.Annotations, key)
	}
	assert.Equal(t, []string{"my-agent"}, node.seedGone, "the staged seed goes once the guest is up")
	old, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	require.NoError(t, err, "the old volume is retained, not deleted")
	assertRetained(t, old, "/home/agent", time.Now().Add(defaultMigrationRetention))
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

// TEST_SCENARIO: a copy that fails is reported and retried, and the machine is never booted from the image instead — that would seed a fresh home and the copy could never land.
func TestAFailedHomeCopyIsReportedAndRetriedWithoutBooting(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	agent.Annotations[annRuntimeMigration] = runtimeMigrationCopying
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	r, node, _ := setupVMReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))

	completeJob(t, r, batchv1.JobFailed, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Equal(t, runtimeMigrationCopying, agent.Annotations[annRuntimeMigration])
	assert.NotEmpty(t, agent.Annotations[annRuntimeMigrationMessage], "the user is told the copy is stuck")
	assert.False(t, node.spec("my-agent").Running)
	_, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "a fresh failure is kept for its logs until the retry delay passes")

	completeJob(t, r, batchv1.JobFailed, time.Now().Add(-2*migrationJobRetryAfter))
	require.NoError(t, r.Reconcile(ctx, agent))
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "an old failure is cleared so the next reconcile copies again")
}

// TEST_SCENARIO: a failed copy names why. The last attempt's own error — vm-seed's error and its causes, carried as the pod's termination message — is shown with the retry, and an earlier attempt's older error is not.
func TestAFailedHomeCopySaysWhyItsLastAttemptFailed(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	agent.Annotations[annRuntimeMigration] = runtimeMigrationCopying
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	r, node, _ := setupVMReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
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
		"copying the home directory failed (Error: uploading the seed to https://runner:4600/machines/my-agent/seed; 0: error sending request; 1: Connection refused (os error 111)); retrying",
		reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage])
}

// TEST_SCENARIO: an agent with no volume at HOME has nothing to copy. The migration says so rather than booting a machine that would silently start from the image.
func TestAMigrationWithNoHomeVolumeSaysSo(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Equal(t, runtimeMigrationRequested, agent.Annotations[annRuntimeMigration])
	assert.Contains(t, agent.Annotations[annRuntimeMigrationMessage], "no volume holds this agent's home")
	assert.False(t, node.spec("my-agent").Running)
}

// TEST_SCENARIO: every phase before the copy has landed keeps the agent down, whatever its activity says; from `booting` on it runs as any agent does.
func TestOnlyABootingMigrationLetsTheAgentRun(t *testing.T) {
	now := time.Now().UTC()
	for phase, runs := range map[string]bool{
		runtimeMigrationRequested: false,
		runtimeMigrationCopying:   false,
		"something-newer":         false,
		runtimeMigrationBooting:   true,
		"":                        true,
	} {
		ann := map[string]string{annLastActivity: now.Format(time.RFC3339)}
		if phase != "" {
			ann[annRuntimeMigration] = phase
		}
		assert.Equal(t, runs, shouldRun(ann, time.Hour, now), "phase %q", phase)
	}
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

// TEST_SCENARIO: an Agent that persisted paths besides HOME on the container backend brings them along. The api-server rewrote its spec and said where each path went; the controller finds each path's volume while the pod is going, mounts it read-only beside the home in the copy Job and names where it goes below HOME, and after the guest has answered retains it with the home, each marked with the path it held. A path no volume was ever made for has nothing to carry, but it is still linked back at boot, since the agent's software still looks there.
func TestAMigrationCarriesTheAgentsOtherPersistedVolumes(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	agent.Spec.Mounts = []apiv1.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/home/agent/.persisted/data", Persist: true},
		{Path: "/home/agent/cache", Persist: true},
		{Path: "/home/agent/.persisted/never", Persist: true},
	}
	agent.Annotations[annRuntimeMigrationMounts] = `{"/data":"/home/agent/.persisted/data","/home/agent/cache":"/home/agent/cache","/never":"/home/agent/.persisted/never"}`
	r, node, _ := setupVMReconciler(t, agent)
	for _, p := range []*corev1.PersistentVolumeClaim{
		homePVC("home-agent-my-agent-0"),
		mountPVC("data-my-agent-0", "/data"),
		mountPVC("home-agent-cache-my-agent-0", "/home/agent/cache"),
	} {
		_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, p, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	require.Equal(t, runtimeMigrationCopying, agent.Annotations[annRuntimeMigration])
	grafts, err := recordedGrafts(agent)
	require.NoError(t, err)
	assert.Equal(t, []runtimeMigrationGraft{
		{From: "/data", At: ".persisted/data", PVC: "data-my-agent-0"},
		{From: "/home/agent/cache", At: "cache", PVC: "home-agent-cache-my-agent-0"},
	}, grafts)

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	pod := job.Spec.Template.Spec
	command := pod.Containers[0].Command
	assert.Contains(t, strings.Join(command, " "), "--graft .persisted/data=/mnt/extra/0 --graft cache=/mnt/extra/1")
	assert.Contains(t, strings.Join(command, " "), `--links [{"path":"/data","at":".persisted/data"},{"path":"/never","at":".persisted/never"}]`,
		"every path moved from outside HOME is linked back at boot, even one no volume was made for; one under HOME keeps its place and needs no link")
	claims := map[string]string{}
	for _, v := range pod.Volumes {
		if v.PersistentVolumeClaim != nil {
			assert.True(t, v.PersistentVolumeClaim.ReadOnly, "the copy never writes to a volume it copies")
			claims[v.Name] = v.PersistentVolumeClaim.ClaimName
		}
	}
	assert.Equal(t, map[string]string{"home": "home-agent-my-agent-0", "extra-0": "data-my-agent-0", "extra-1": "home-agent-cache-my-agent-0"}, claims)

	completeJob(t, r, batchv1.JobComplete, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
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
