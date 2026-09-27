// TEST_OVERVIEW: a runtime migration moves an Agent's home from the volume its container mounted onto the disk of a machine on its owner's runner. What must hold at every phase is that nothing runs while the copy is taken, the copy reaches the machine before its first boot, and the old volume outlives the migration until the new guest has answered — so a failure anywhere leaves the agent's work where it was.
package reconciler

import (
	"context"
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

// TEST_SCENARIO: a migration walks every phase: the old pod is waited out and its StatefulSet and headless Service removed, the machine is created and left stopped while a Job streams the home volume to the owner's runner, and only once that Job has finished is the machine allowed to boot. The old volume and the staged seed are both removed after the guest answers, and not a reconcile sooner.
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
	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, "home-agent-my-agent-0", metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the old volume goes once the guest is up")
	assert.Equal(t, []string{"my-agent"}, node.seedGone, "and so does the staged seed")
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
	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "default", 10000, nil, nil)
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
