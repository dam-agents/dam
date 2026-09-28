// TEST_OVERVIEW: the copy Job a runtime migration runs is confined, pinned to its owner's runner and throttled, and every step that holds a migration up — on the cluster side or the runner's — is said on the Agent in words that are safe to show. A migration that has nothing to copy, a boot that nothing may cut short, a runner claim that has to hold the seed beside the disk, and a leftover Job from an Agent of the same name are each handled rather than waited on forever.
package reconciler

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const testRunnerPodIP = "10.244.1.7"

// UNIT_BOUNDARY_DESCRIPTION: a migration's copy Job pins its owner's runner pod by address, so the tests give the owner a ready runner pod beside the ready Deployment the VM tests already have.
func setupMigrationReconciler(t *testing.T, agent *apiv1.Agent) (*AgentReconciler, *fakeNode, *requeueLog) {
	t.Helper()
	r, node, requeued := setupVMReconciler(t, agent)
	_, err := r.client.CoreV1().Pods("test-agents").Create(context.Background(), &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner-" + runnerSuffix(testOwner) + "-abc", Namespace: "test-agents", Labels: vmRunnerSelector(testOwner)},
		Status: corev1.PodStatus{
			PodIP:      testRunnerPodIP,
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
		},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	return r, node, requeued
}

func copyingAgentCR() *apiv1.Agent {
	agent := migratingAgentCR()
	agent.Annotations[annRuntimeMigration] = runtimeMigrationCopying
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	return agent
}

func startCopy(t *testing.T, agent *apiv1.Agent, sources ...*corev1.PersistentVolumeClaim) (*AgentReconciler, *fakeNode, *batchv1.Job) {
	t.Helper()
	ctx := context.Background()
	r, node, _ := setupMigrationReconciler(t, agent)
	for _, pvc := range sources {
		_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, pvc, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	return r, node, job
}

func blockHome() *corev1.PersistentVolumeClaim {
	pvc := homePVC("home-agent-my-agent-0")
	pvc.Spec.AccessModes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}
	return pvc
}

func agentEvents(t *testing.T, r *AgentReconciler) map[string][]string {
	t.Helper()
	list, err := r.client.CoreV1().Events("test-agents").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	out := map[string][]string{}
	for _, e := range list.Items {
		if e.InvolvedObject.Kind == "Agent" && e.InvolvedObject.Name == "my-agent" {
			out[e.Reason] = append(out[e.Reason], e.Message)
		}
	}
	return out
}

// TEST_SCENARIO: the copy pod runs confined — no privilege escalation, a read-only root with a scratch directory, the runtime's default seccomp profile, a bound on its scratch disk — and keeps the agent pods' RuntimeClass, since it only reads. Its credentials are readable by whichever identity it runs as.
func TestTheCopyJobRunsConfined(t *testing.T) {
	agent := copyingAgentCR()
	agent.Spec.RuntimeClassName = "kata"
	_, _, job := startCopy(t, agent, blockHome())
	pod := job.Spec.Template.Spec

	require.NotNil(t, pod.SecurityContext)
	assert.Equal(t, corev1.SeccompProfileTypeRuntimeDefault, pod.SecurityContext.SeccompProfile.Type)
	sc := pod.Containers[0].SecurityContext
	require.NotNil(t, sc)
	assert.False(t, *sc.AllowPrivilegeEscalation)
	assert.True(t, *sc.ReadOnlyRootFilesystem)
	assert.Equal(t, []corev1.Capability{"ALL"}, sc.Capabilities.Drop)
	assert.Equal(t, corev1.SeccompProfileTypeRuntimeDefault, sc.SeccompProfile.Type)
	require.NotNil(t, pod.RuntimeClassName)
	assert.Equal(t, "kata", *pod.RuntimeClassName)

	res := pod.Containers[0].Resources
	assert.False(t, res.Requests.StorageEphemeral().IsZero())
	assert.False(t, res.Limits.StorageEphemeral().IsZero())

	writable := map[string]bool{}
	for _, m := range pod.Containers[0].VolumeMounts {
		writable[m.MountPath] = !m.ReadOnly
	}
	assert.Equal(t, map[string]bool{runtimeMigrationSourcePath: false, runtimeMigrationCredsPath: false, "/tmp": true}, writable, "only the scratch directory is written")
	for _, v := range pod.Volumes {
		if v.Projected != nil {
			assert.Equal(t, int32(0o444), *v.Projected.DefaultMode, "a projected Secret file is root's, so the agent's uid reads it by mode")
		}
		if v.EmptyDir != nil {
			assert.NotNil(t, v.EmptyDir.SizeLimit)
		}
	}
}

// TEST_SCENARIO: a share may squash root, which then gets EACCES on the agent's own 0600 files, so a copy with any shared volume reads as the agent's uid with no capability. A block volume squashes nothing but holds a root-owned 0700 lost+found the agent's uid cannot open, so a copy of block volumes alone reads as root with DAC_READ_SEARCH and nothing else — it can read everything and write nothing.
func TestTheCopyReadsAsTheIdentityItsVolumesCallFor(t *testing.T) {
	shared := homePVC("home-agent-my-agent-0")
	shared.Spec.AccessModes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany}
	_, _, job := startCopy(t, copyingAgentCR(), shared)
	pod := job.Spec.Template.Spec
	assert.Equal(t, int64(migrationFallbackUID), *pod.SecurityContext.RunAsUser)
	assert.Equal(t, int64(migrationFallbackGID), *pod.SecurityContext.RunAsGroup)
	assert.True(t, *pod.SecurityContext.RunAsNonRoot)
	assert.Empty(t, pod.Containers[0].SecurityContext.Capabilities.Add)

	_, _, job = startCopy(t, copyingAgentCR(), blockHome())
	pod = job.Spec.Template.Spec
	assert.Equal(t, int64(0), *pod.SecurityContext.RunAsUser)
	assert.False(t, *pod.SecurityContext.RunAsNonRoot)
	assert.Equal(t, []corev1.Capability{"DAC_READ_SEARCH"}, pod.Containers[0].SecurityContext.Capabilities.Add)
	assert.Equal(t, []corev1.Capability{"ALL"}, pod.Containers[0].SecurityContext.Capabilities.Drop)
}

// TEST_SCENARIO: a volume the migration recorded and that is gone since cannot be copied; the migration says which, rather than failing every reconcile.
func TestAMissingSourceVolumeIsNamed(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	r, node, _ := setupMigrationReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "home-agent-my-agent-0")
}

// TEST_SCENARIO: the copy pod reaches its owner's runner and nothing else, and needs no resolver for it: the runner's name is pinned to the ready runner pod's address in the pod's hosts file, so the URL keeps the name the runner's certificate is issued for. Its NetworkPolicy admits nothing in and lets out only the machine API port of that owner's runner pods — no DNS — and goes once the copy has landed.
func TestTheCopyJobReachesOnlyItsOwnersRunner(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	r, _, job := startCopy(t, agent, blockHome())
	pod := job.Spec.Template.Spec
	require.Len(t, pod.HostAliases, 1)
	assert.Equal(t, testRunnerPodIP, pod.HostAliases[0].IP)
	assert.Equal(t, []string{r.runnerHost(testOwner)}, pod.HostAliases[0].Hostnames)

	np, err := r.client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	for k, v := range np.Spec.PodSelector.MatchLabels {
		assert.Equal(t, v, job.Spec.Template.Labels[k], "the policy selects the copy pod by %s", k)
	}
	assert.Equal(t, RoleRuntimeMigration, np.Spec.PodSelector.MatchLabels[LabelRole], "a storage migration's pod carries the same migration-for label, and is not selected")
	assert.ElementsMatch(t, []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress}, np.Spec.PolicyTypes)
	assert.Empty(t, np.Spec.Ingress)
	require.Len(t, np.Spec.Egress, 1)
	rule := np.Spec.Egress[0]
	require.Len(t, rule.To, 1)
	assert.Nil(t, rule.To[0].IPBlock)
	assert.Nil(t, rule.To[0].NamespaceSelector)
	assert.Equal(t, vmRunnerSelector(testOwner), rule.To[0].PodSelector.MatchLabels)
	require.Len(t, rule.Ports, 1)
	assert.Equal(t, int32(vmRunnerPort), rule.Ports[0].Port.IntVal, "the machine API alone, and no port 53")

	completeJob(t, r, batchv1.JobComplete, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	_, err = r.client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the policy goes with the finished copy")
}

// TEST_SCENARIO: an owner copies one migration at a time by default, and the install caps how many copy at once, so a wave of migrations cannot saturate storage or one runner's claim. A migration over either cap waits without a Job and says why; a finished copy holds no slot.
func TestCopyJobsAreThrottledPerOwnerAndInTheInstall(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	r, node, _ := setupMigrationReconciler(t, agent)
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, blockHome(), metav1.CreateOptions{})
	require.NoError(t, err)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	running := func(name, owner string, done bool) {
		job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "test-agents", Labels: map[string]string{LabelRole: RoleRuntimeMigration, envoyOwnerLabel: owner}}}
		if done {
			job.Status.Conditions = []batchv1.JobCondition{{Type: batchv1.JobComplete, Status: corev1.ConditionTrue}}
		}
		_, err := r.client.BatchV1().Jobs("test-agents").Create(ctx, job, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	running("rtm-finished", testOwner, true)
	running("rtm-sibling", testOwner, false)

	require.NoError(t, r.Reconcile(ctx, agent))
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the owner's slot is taken")
	assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "of this owner's migrations are copying")

	require.NoError(t, r.client.BatchV1().Jobs("test-agents").Delete(ctx, "rtm-sibling", metav1.DeleteOptions{}))
	r.config.VM.RuntimeMigration.Concurrency = 2
	running("rtm-a", "someone-else", false)
	running("rtm-b", "someone-else", false)
	require.NoError(t, r.Reconcile(ctx, agent))
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the install's slots are taken")
	assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "migrations are copying in this install")

	r.config.VM.RuntimeMigration.Concurrency = 3
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "a free slot starts the copy")
	assert.NotContains(t, reloaded(t, r, agent).Annotations, annRuntimeMigrationMessage, "and the wait is no longer reported")
}

// TEST_SCENARIO: a copy Job left by a deleted Agent of the same name, finished or not, is not this Agent's copy: counting it as Complete would boot a machine whose seed was never written. It is removed and the copy runs again under this Agent.
func TestACopyJobOfAnEarlierAgentOfTheSameNameIsNotTrusted(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	r, node, _ := setupMigrationReconciler(t, agent)
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, blockHome(), metav1.CreateOptions{})
	require.NoError(t, err)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	stale := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name: runtimeMigrationJobName("my-agent"), Namespace: "test-agents",
			OwnerReferences: []metav1.OwnerReference{{APIVersion: "agent-platform.ai/v1", Kind: "Agent", Name: "my-agent", UID: "an-earlier-agent"}},
		},
		Status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{{Type: batchv1.JobComplete, Status: corev1.ConditionTrue}}},
	}
	_, err = r.client.BatchV1().Jobs("test-agents").Create(ctx, stale, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Equal(t, runtimeMigrationCopying, agent.Annotations[annRuntimeMigration], "the stale Job does not finish this copy")
	_, err = r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the stale Job is removed")

	require.NoError(t, r.Reconcile(ctx, agent))
	job, err := r.client.BatchV1().Jobs("test-agents").Get(ctx, runtimeMigrationJobName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, ownedBy(job, agent), "the new Job is this Agent's")
}

// TEST_SCENARIO: while the migration waits in `requested` or `copying`, what the runner reports is written on the Agent: a runner that is not ready with the reason found for it, and a machine the runner failed to create, which stays absent rather than stopped. Once the runner can take the copy again, the message goes.
func TestTheRunnersProblemsAreReportedBeforeTheMachineBoots(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	r, node, _ := setupMigrationReconciler(t, agent)
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, blockHome(), metav1.CreateOptions{})
	require.NoError(t, err)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonImageUnavailable, Message: "pulling quay.io/example/claude-code-vm:1: manifest unknown"})
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Equal(t, "the new machine is absent: pulling quay.io/example/claude-code-vm:1: manifest unknown", agent.Annotations[annRuntimeMigrationMessage])

	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, "platform-vm-runner-"+runnerSuffix(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Status.ReadyReplicas = 0
	_, err = r.client.AppsV1().Deployments("test-agents").UpdateStatus(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, containerAgentPod(), metav1.CreateOptions{})
	require.NoError(t, err)
	for _, phase := range []string{runtimeMigrationRequested, runtimeMigrationCopying} {
		agent.Annotations[annRuntimeMigration] = phase
		require.NoError(t, r.Reconcile(ctx, agent))
		assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "the owner's VM runner", phase)
	}
	require.NoError(t, r.client.CoreV1().Pods("test-agents").Delete(ctx, "my-agent-0", metav1.DeleteOptions{}))

	dep.Status.ReadyReplicas = 1
	_, err = r.client.AppsV1().Deployments("test-agents").UpdateStatus(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
	assert.NotContains(t, reloaded(t, r, agent).Annotations, annRuntimeMigrationMessage)
}

// TEST_SCENARIO: an old pod stuck terminating — its node gone quiet — would hold `requested` forever without a word. After a few minutes the message names the pod and its node, since only an operator who can reach that node can end it; a pod only just going says nothing.
func TestAnOldPodStuckTerminatingIsNamedWithItsNode(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	r, _, _ := setupMigrationReconciler(t, agent)
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, homePVC("home-agent-my-agent-0"), metav1.CreateOptions{})
	require.NoError(t, err)
	pod := containerAgentPod()
	pod.Spec.NodeName = "worker-3"
	pod.DeletionTimestamp = new(metav1.NewTime(time.Now().Add(-10 * time.Second)))
	_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.NotContains(t, agent.Annotations, annRuntimeMigrationMessage)

	pod.DeletionTimestamp = new(metav1.NewTime(time.Now().Add(-10 * time.Minute)))
	_, err = r.client.CoreV1().Pods("test-agents").Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	msg := reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage]
	assert.Contains(t, msg, "my-agent-0")
	assert.Contains(t, msg, "worker-3")
}

// TEST_SCENARIO: a copy pod that cannot start — its volume still attached to the old node — says so only in its Events. The message carries that warning while the pod waits, and a Job that failed without its container ever running says the same rather than a bare "failed".
func TestACopyPodThatCannotStartSaysWhy(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	r, _, job := startCopy(t, agent, blockHome())
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: job.Name + "-x", Namespace: "test-agents", UID: "copy-pod", Labels: map[string]string{batchv1.JobNameLabel: job.Name}},
		Status:     corev1.PodStatus{Phase: corev1.PodPending},
	}
	_, err := r.client.CoreV1().Pods("test-agents").Create(ctx, pod, metav1.CreateOptions{})
	require.NoError(t, err)
	for i, e := range []corev1.Event{
		{Reason: "Scheduled", Type: corev1.EventTypeNormal, Message: "assigned"},
		{Reason: "FailedAttachVolume", Type: corev1.EventTypeWarning, Message: `Multi-Attach error for volume "pvc-1" Volume is already exclusively attached to one node`},
	} {
		e.ObjectMeta = metav1.ObjectMeta{Name: pod.Name + "." + string(rune('a'+i)), Namespace: "test-agents"}
		e.InvolvedObject = corev1.ObjectReference{Kind: "Pod", Name: pod.Name, UID: pod.UID}
		e.LastTimestamp = metav1.NewTime(time.Now().Add(time.Duration(i) * time.Second))
		_, err := r.client.CoreV1().Events("test-agents").Create(ctx, &e, metav1.CreateOptions{})
		require.NoError(t, err)
	}

	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Contains(t, agent.Annotations[annRuntimeMigrationMessage], "FailedAttachVolume: Multi-Attach error")
	assert.Contains(t, agent.Annotations[annRuntimeMigrationMessage], pod.Name)

	completeJob(t, r, batchv1.JobFailed, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	assert.Contains(t, agent.Annotations[annRuntimeMigrationMessage], "copying the home directory failed (FailedAttachVolume: Multi-Attach error")
}

// TEST_SCENARIO: a migration's steps are Events on the Agent: each phase it enters, a copy that failed — once, not on every reconcile that still sees the failed Job — and the move's end.
func TestAMigrationReportsItsStepsAsEvents(t *testing.T) {
	ctx := context.Background()
	agent := migratingAgentCR()
	r, node, _ := setupMigrationReconciler(t, agent)
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, homePVC("home-agent-my-agent-0"), metav1.CreateOptions{})
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent))
	agent = reloaded(t, r, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	completeJob(t, r, batchv1.JobFailed, time.Now())
	for range 3 {
		agent = reloaded(t, r, agent)
		require.NoError(t, r.Reconcile(ctx, agent))
	}
	completeJob(t, r, batchv1.JobFailed, time.Now().Add(-2*migrationJobRetryAfter))
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
	completeJob(t, r, batchv1.JobComplete, time.Now())
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.NoError(t, r.Reconcile(ctx, reloaded(t, r, agent)))

	events := agentEvents(t, r)
	assert.Len(t, events["RuntimeMigrationCopying"], 1)
	assert.Len(t, events["RuntimeMigrationCopyFailed"], 1, "a failure is reported once")
	assert.Len(t, events["RuntimeMigrationBooting"], 1)
	assert.Len(t, events["RuntimeMigrationFinished"], 1)
}

// TEST_SCENARIO: what vm-seed writes on failure names the agent's own files, and a file name can carry terminal escapes or a text-direction override. The message escapes every control and formatting character, replaces the runner's in-cluster URL, host and any address with a fixed phrase, and is cut to a status line's length.
func TestAMigrationMessageIsSafeToShow(t *testing.T) {
	host := "platform-vm-runner-abc.test-agents.svc"
	msg := sanitizeMigrationMessage("Error: uploading the seed to https://"+host+":4600/machines/m/seed; reading /mnt/home/evil\x1b[31mred\u202etxt.exe; the runner at "+host+":4600 or 10.244.1.7:4600 said no", host)
	assert.NotContains(t, msg, host)
	assert.NotContains(t, msg, "10.244.1.7")
	assert.NotContains(t, msg, "\x1b")
	assert.NotContains(t, msg, "\u202e")
	assert.Contains(t, msg, "evil\\u001b[31mred\\u202etxt.exe")
	assert.Contains(t, msg, "uploading the seed to the owner's VM runner;")
	assert.Contains(t, msg, "the runner at the owner's VM runner or an in-cluster address said no")

	long := sanitizeMigrationMessage(strings.Repeat("é", 1000)+"\xff", "")
	assert.Equal(t, runtimeMigrationMessageMax+1, len([]rune(long)), "cut by characters, never inside one")
}

// TEST_SCENARIO: the seed waits on the owner's runner claim beside the disk it is restored into, so from the copy until the guest has booted from it, the claim counts the size of the volumes it was read from. Once the migration is over it counts nothing.
func TestTheRunnerClaimHoldsRoomForAMigrationsSeed(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	agent.Annotations[annRuntimeMigrationGrafts] = `[{"from":"/data","at":".persisted/data","pvc":"data-my-agent-0"}]`
	r, _, _ := setupMigrationReconciler(t, agent)
	for name, size := range map[string]string{"home-agent-my-agent-0": "10Gi", "data-my-agent-0": "5Gi"} {
		pvc := homePVC(name)
		pvc.Spec.Resources.Requests = corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(size)}
		_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, pvc, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	for phase, seed := range map[string]int64{runtimeMigrationCopying: 15 << 30, runtimeMigrationBooting: 15 << 30, runtimeMigrationRequested: 0, "": 0} {
		a := agent.DeepCopy()
		a.Annotations[annRuntimeMigration] = phase
		d, err := r.ownerRunnerDemand(ctx, testOwner, a, false)
		require.NoError(t, err)
		assert.Equal(t, seed, d.seedBytes, "phase %q", phase)
	}

	expandableDefaultClass(t, r, true)
	r.config.VM.Runner.ImageCacheHostPath = "/var/lib/platform-images"
	require.NoError(t, r.applyRunnerPVC(ctx, testOwner, runnerDemand{diskGiB: 20, machines: 1, seedBytes: 15 << 30}, nil))
	assert.Equal(t, "36Gi", runnerClaim(t, r), "20Gi of disk, 1Gi of headroom and the 15Gi seed beside it")
}

// TEST_SCENARIO: `booting` is proven only by a guest that answers, so until then nothing that parks an idle agent may stop it: not the idle timeout, not a reclaim stamp, and a booting agent is never picked to make room for another. A stop the user asks for still wins, and is said on the Agent.
func TestABootingMigrationRunsUntilItsGuestAnswers(t *testing.T) {
	now := time.Now().UTC()
	ann := map[string]string{
		annRuntimeMigration: runtimeMigrationBooting,
		annLastActivity:     now.Add(-3 * time.Hour).Format(time.RFC3339),
		annReclaimedAt:      now.Format(time.RFC3339),
	}
	assert.True(t, shouldRun(ann, time.Hour, now), "idle for hours and reclaimed, a booting agent still runs")
	_, eligible := reclaimEligible(ann, time.Hour, now)
	assert.False(t, eligible)

	ann[annStopRequested] = "true"
	assert.False(t, shouldRun(ann, time.Hour, now), "a user's stop wins")
	assert.Contains(t, runtimeMigrationBootHeld(ann, true, ""), "stopped before its new machine first answered")

	ctx := context.Background()
	agent := migratingAgentCR()
	agent.Annotations[annRuntimeMigration] = runtimeMigrationBooting
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	agent.Annotations[annStopRequested] = "true"
	r, node, _ := setupMigrationReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, node.spec("my-agent").Running)
	assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "the move finishes when it next starts")
}

// TEST_SCENARIO: a migration boot over the owner's budget waits and says why, and keeps being retried rather than parked until the next activity. It does not hibernate the owner's idle agents to make room: the user asked to move one agent, not to stop others.
func TestABootingMigrationOverBudgetWaitsWithoutReclaiming(t *testing.T) {
	ctx := context.Background()
	peer, peerSS := idlePeer("peer", "3900m", "1Gi", 10*time.Minute, nil)
	peer.Labels[envoyOwnerLabel] = testOwner
	agent := migratingAgentCR()
	agent.Annotations[annRuntimeMigration] = runtimeMigrationBooting
	agent.Annotations[annRuntimeMigrationSource] = "home-agent-my-agent-0"
	r, node, _ := setupMigrationReconciler(t, agent)
	r.busyProbe = func(context.Context, string) bool { return false }
	_, err := r.client.AppsV1().StatefulSets("test-agents").Create(ctx, peerSS, metav1.CreateOptions{})
	require.NoError(t, err)
	peerU, err := agentToUnstructured(peer)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, peerU, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, node.spec("my-agent").Running)
	assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "waiting for room in the owner's budget")
	assert.Equal(t, int32(1), agentSSReplicas(t, r, "peer"), "the idle peer is left running")
	_, retried := r.parkedRetry["my-agent"]
	assert.True(t, retried, "the boot is retried on its own")
}

// TEST_SCENARIO: the sweep deletes a retained volume only if it is still the one it read, by UID and version, so an operator who extended the window between the list and the delete keeps the volume. Each deletion is an Event on the Agent, or on the claim once the Agent is gone.
func TestTheRetentionSweepDeletesOnlyWhatItRead(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	past := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	orphan := retainedPVC("orphaned", past)
	orphan.Labels[LabelRetainedFor] = "deleted-agent"
	for _, p := range []*corev1.PersistentVolumeClaim{retainedPVC("expired", past), orphan} {
		p.UID = k8stypes.UID("uid-" + p.Name)
		p.ResourceVersion = "7"
		_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, p, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	var preconditions []*metav1.Preconditions
	r.client.(*fake.Clientset).PrependReactor("delete", "persistentvolumeclaims", func(action k8stesting.Action) (bool, runtime.Object, error) {
		preconditions = append(preconditions, action.(k8stesting.DeleteAction).GetDeleteOptions().Preconditions)
		return false, nil, nil
	})

	r.ReconcileRetainedVolumes(ctx)

	require.Len(t, preconditions, 2)
	for _, p := range preconditions {
		require.NotNil(t, p)
		assert.NotEmpty(t, *p.UID)
		assert.Equal(t, "7", *p.ResourceVersion)
	}
	assert.Len(t, agentEvents(t, r)["RetainedVolumeDeleted"], 1, "the expired volume is reported on its Agent")
	list, err := r.client.CoreV1().Events("test-agents").List(ctx, metav1.ListOptions{})
	require.NoError(t, err)
	var onClaim int
	for _, e := range list.Items {
		if e.InvolvedObject.Kind == "PersistentVolumeClaim" && e.InvolvedObject.Name == "orphaned" {
			onClaim++
		}
	}
	assert.Equal(t, 1, onClaim, "the orphan's deletion is reported on the claim")
}

// TEST_SCENARIO: a volume the Agent already owns — a warm-pool claim the Agent took as its controller — keeps one reference to it when retained, not a second with the same UID.
func TestRetainingAVolumeTheAgentOwnsAddsNoSecondReference(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	pvc := homePVC("home-agent-my-agent-0")
	pvc.OwnerReferences = []metav1.OwnerReference{agentOwnerRef(agent)}
	_, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Create(ctx, pvc, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.retainMigratedVolume(ctx, agent, pvc.Name, agentHomeDir, time.Now().Add(time.Hour)))
	got, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, pvc.Name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, got.OwnerReferences, 1)
}

// TEST_SCENARIO: a storage-migration gate set just before the Agent moved to the vm backend would hold its machine down forever, since the storage manager leaves vm Agents alone. The Agent's reconcile ignores that gate for a vm Agent, and the manager releases it, abandoning the copy it started but keeping every volume a runtime migration may still read.
func TestAStorageMigrationGateOnAVMAgentIsReleased(t *testing.T) {
	agent := agentCR()
	agent.Spec.Backend = &apiv1.Backend{Type: "vm"}
	agent.Annotations = map[string]string{annStorageMigration: "migrating", annStorageMigrationWasRunning: "true"}
	target := rwxPVC("mig-home-agent-my-agent-0", "", "home-agent")
	delete(target.Labels, LabelAgent)
	target.Labels[LabelMigrationFor] = "my-agent"
	superseded := rwxPVC("old-home", "", "home-agent")
	superseded.Labels = map[string]string{LabelMigrationSuperseded: "my-agent"}
	job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "mig-my-agent", Namespace: "test-agents"}}
	m, client := migrationManager(t, agent, rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent"), target, superseded, job)

	m.Reconcile(context.Background())

	ann := getAgentAnnotations(t, m, "my-agent")
	assert.NotContains(t, ann, annStorageMigration)
	assert.NotContains(t, ann, annStorageMigrationWasRunning)
	_, err := client.BatchV1().Jobs("test-agents").Get(context.Background(), "mig-my-agent", metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the abandoned copy is stopped")
	_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), target.Name, metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a target never flipped in is removed")
	for _, kept := range []string{"home-agent-my-agent-0", "old-home"} {
		_, err = client.CoreV1().PersistentVolumeClaims("test-agents").Get(context.Background(), kept, metav1.GetOptions{})
		assert.NoError(t, err, kept)
	}
}

// TEST_SCENARIO: the storage manager works from one List of the Agents, and an Agent can move to the vm backend after it. A copy that finished for such an Agent is not flipped — that would relabel and delete the very volume the runtime migration reads — and an Agent not yet gated is not gated.
func TestTheStorageManagerRechecksTheBackendBeforeActing(t *testing.T) {
	ctx := context.Background()
	stale := agentCR()
	stale.Annotations = map[string]string{annStorageMigration: "migrating"}
	moved := stale.DeepCopy()
	moved.Spec.Backend = &apiv1.Backend{Type: "vm"}
	target := rwxPVC("mig-home-agent-my-agent-0", "", "home-agent")
	delete(target.Labels, LabelAgent)
	target.Labels[LabelMigrationFor] = "my-agent"
	target.Spec.AccessModes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "mig-my-agent", Namespace: "test-agents"},
		Status:     batchv1.JobStatus{Conditions: []batchv1.JobCondition{{Type: batchv1.JobComplete, Status: corev1.ConditionTrue}}},
	}
	source := rwxPVC("home-agent-my-agent-0", "my-agent", "home-agent")
	m, client := migrationManager(t, moved, source, target, job)

	require.NoError(t, m.migrateAgent(ctx, stale, []corev1.PersistentVolumeClaim{*source}, ""))
	got, err := client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, source.Name, metav1.GetOptions{})
	require.NoError(t, err, "the source is not deleted")
	assert.Equal(t, "my-agent", got.Labels[LabelAgent], "nor stripped of the labels the runtime migration finds it by")

	fresh := agentCR()
	require.NoError(t, m.migrateAgent(ctx, fresh, []corev1.PersistentVolumeClaim{*source}, ""))
	assert.NotContains(t, getAgentAnnotations(t, m, "my-agent"), annStorageMigrationWasRunning, "a vm Agent is not gated")
}

// TEST_SCENARIO: one process reads every volume, so a set of a shared and a block volume reads as root with DAC_READ_SEARCH, which reads the block volume's root-owned lost+found for certain. A share beside it that squashes root then refuses the copy, and that failure says so and what to do, rather than repeating a bare permission error.
func TestAMixedSetOfVolumesReadsAsRootAndExplainsASquashedShare(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	agent.Annotations[annRuntimeMigrationGrafts] = `[{"from":"/data","at":".persisted/data","pvc":"data-my-agent-0"}]`
	share := mountPVC("data-my-agent-0", "/data")
	share.Spec.AccessModes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany}
	r, _, job := startCopy(t, agent, blockHome(), share)
	pod := job.Spec.Template.Spec
	assert.Equal(t, int64(0), *pod.SecurityContext.RunAsUser)
	assert.Equal(t, []corev1.Capability{"DAC_READ_SEARCH"}, pod.Containers[0].SecurityContext.Capabilities.Add)

	_, err := r.client.CoreV1().Pods("test-agents").Create(ctx, &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: job.Name + "-x", Namespace: "test-agents", Labels: map[string]string{batchv1.JobNameLabel: job.Name}},
		Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{Name: "seed", State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			ExitCode: 1, FinishedAt: metav1.Now(), Message: "Error: archiving the seed: reading /mnt/extra/0/" + strings.Repeat("deep/", 80) + "notes.md: Permission denied (os error 13)",
		}}}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	completeJob(t, r, batchv1.JobFailed, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	msg := reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage]
	assert.Contains(t, msg, runtimeMigrationMixedHint, "the advice survives the cut; vm-seed's long path is what is cut")
	assert.True(t, strings.HasSuffix(msg, "…"), "the message was long enough to be cut")
}

// TEST_SCENARIO: a copy pod that admission refused — an SCC that does not permit what it asks for — never exists, so the Job's FailedCreate event is what the message carries, while the Job waits and once it has failed.
func TestACopyPodRefusedAtAdmissionSaysWhy(t *testing.T) {
	ctx := context.Background()
	agent := copyingAgentCR()
	r, _, job := startCopy(t, agent, blockHome())
	job.UID = "copy-job"
	_, err := r.client.BatchV1().Jobs("test-agents").Update(ctx, job, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Events("test-agents").Create(ctx, &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: job.Name + ".a", Namespace: "test-agents"},
		InvolvedObject: corev1.ObjectReference{Kind: "Job", Name: job.Name, UID: job.UID},
		Type:           corev1.EventTypeWarning,
		Reason:         "FailedCreate",
		Message:        `Error creating: pods "rtm-my-agent-x" is forbidden: unable to validate against any security context constraint`,
		LastTimestamp:  metav1.Now(),
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "the copy pod could not be created: FailedCreate")

	completeJob(t, r, batchv1.JobFailed, time.Now())
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Contains(t, reloaded(t, r, agent).Annotations[annRuntimeMigrationMessage], "copying the home directory failed (FailedCreate")
}
