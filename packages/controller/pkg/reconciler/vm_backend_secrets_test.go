// TEST_OVERVIEW: a machine takes only its owner's Secrets, loses a Secret whose ref was refused, and names the kill when its runner was OOM-killed; its Secrets are read in two rounds so the list is one call.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/kubernetes/fake"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func TestAVMAgentTakesOnlyItsOwnersSecret(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.SecretRef = "mine"
	r, node, _ := setupVMReconciler(t, agent)
	envSecret(t, r, "mine", map[string]string{envoyOwnerLabel: testOwner})
	require.NoError(t, r.Reconcile(context.Background(), agent))
	assert.Equal(t, "s3cr3t-value", node.spec("my-agent").Env["SECRET_TOKEN"])

	for name, labels := range map[string]map[string]string{
		"theirs":    {envoyOwnerLabel: "someone-else"},
		"unlabeled": nil,
		"managed":   {envoyOwnerLabel: testOwner, envoyManagedByLabel: "api-server"},
		"runner":    {envoyOwnerLabel: testOwner, "app.kubernetes.io/component": vmRunnerComponent},
	} {
		t.Run(name, func(t *testing.T) {
			agent := vmAgentCR()
			agent.Spec.SecretRef = name
			r, node, _ := setupVMReconciler(t, agent)
			envSecret(t, r, name, labels)
			err := r.Reconcile(context.Background(), agent)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "secretRef "+name)
			assert.NotContains(t, err.Error(), "s3cr3t-value", "the refusal names the Secret, never its contents")
			assert.NotEmpty(t, node.spec("my-agent").Image, "the machine is still ensured, only without the refused Secret")
			for _, v := range node.spec("my-agent").Env {
				assert.NotEqual(t, "s3cr3t-value", v)
			}
		})
	}
}

func TestARefusedSecretRefIsTakenOffAMachineThatHadIt(t *testing.T) {
	agent := vmAgentCR()
	agent.Spec.SecretRef = "theirs"
	r, node, _ := setupVMReconciler(t, agent)
	envSecret(t, r, "theirs", map[string]string{envoyOwnerLabel: testOwner})
	require.NoError(t, r.Reconcile(context.Background(), agent))
	require.Equal(t, "s3cr3t-value", node.spec("my-agent").Env["SECRET_TOKEN"])

	sec, err := r.client.CoreV1().Secrets("test-agents").Get(context.Background(), "theirs", metav1.GetOptions{})
	require.NoError(t, err)
	sec.Labels[envoyOwnerLabel] = "someone-else"
	_, err = r.client.CoreV1().Secrets("test-agents").Update(context.Background(), sec, metav1.UpdateOptions{})
	require.NoError(t, err)

	err = r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "secretRef theirs")
	assert.NotContains(t, node.spec("my-agent").Env, "SECRET_TOKEN")
}

func TestAContainerAgentTakesOnlyItsOwnersSecret(t *testing.T) {
	agent := agentCR()
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	agent.Spec.SecretRef = "theirs"
	r, _ := setupReconciler(t, agent)
	envSecret(t, r, "theirs", map[string]string{envoyOwnerLabel: "someone-else"})

	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "secretRef theirs")
	ss, err := r.client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-agent", metav1.GetOptions{})
	require.NoError(t, err, "the pod is still rendered, only without the refused Secret")
	for _, c := range ss.Spec.Template.Spec.Containers {
		for _, from := range c.EnvFrom {
			assert.Nil(t, from.SecretRef, "no pod may carry another owner's Secret as its environment")
		}
	}

	sec, err := r.client.CoreV1().Secrets("test-agents").Get(context.Background(), "theirs", metav1.GetOptions{})
	require.NoError(t, err)
	sec.Labels[envoyOwnerLabel] = testOwner
	_, err = r.client.CoreV1().Secrets("test-agents").Update(context.Background(), sec, metav1.UpdateOptions{})
	require.NoError(t, err)
	got, err := r.ownedSecretRef(context.Background(), agent)
	require.NoError(t, err, "labelling the Secret with its owner is all an existing one needs")
	assert.Equal(t, "theirs", got.Name)
}

func TestEveryAgentOfAnOOMKilledRunnerNamesTheKill(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	r.vmRunning.Store(agent.Name, true)
	r.vmRunningSince.Store(agent.Name, time.Now().Add(-time.Hour))
	agent.Status.Conditions = []metav1.Condition{{
		Type: apiv1.ConditionAgentPodReady, Status: metav1.ConditionTrue, LastTransitionTime: metav1.NewTime(time.Now().Add(-time.Hour)),
	}}
	pods := r.client.CoreV1().Pods("test-agents")
	runner, err := pods.Get(ctx, readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	runner.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			Reason: "OOMKilled", FinishedAt: metav1.NewTime(time.Now().Add(-time.Minute)),
		}},
	}}
	_, err = pods.UpdateStatus(ctx, runner, metav1.UpdateOptions{})
	require.NoError(t, err)

	reason := func() string {
		got, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, agent.Name, metav1.GetOptions{})
		require.NoError(t, err)
		conds, _, _ := unstructured.NestedSlice(got.Object, "status", "conditions")
		for _, c := range conds {
			if m, ok := c.(map[string]any); ok && m["type"] == apiv1.ConditionAgentPodReady {
				return m["reason"].(string)
			}
		}
		return ""
	}

	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"}, true))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, reason(), "an agent refused room after the kill")

	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonOOMKilled, Message: "the kernel killed the machine's VMM"}, true))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, reason(), "an agent carrying a machine's own kill reason")

	require.NoError(t, r.publishVMReadiness(ctx, agent, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true}, true))
	assert.Equal(t, "PodReady", reason(), "an agent that is up again: the notice reads a reason published while it is down")

	// TEST_SCENARIO: the kill stays in the runner's last termination for the whole episode, and the agent answered after it: a failure that follows is its own, not the kill's again.
	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonBootFailed, Message: "the guest console ends: panic"}, true))
	assert.Equal(t, vmrunner.ReasonBootFailed, reason(), "a boot that failed after the agent had been up since the kill")
	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonSeccompKilled, Message: "the machine's VMM made a call its seccomp filter forbids"}, true))
	assert.Equal(t, vmrunner.ReasonSeccompKilled, reason(), "a seccomp kill after the agent had been up since the kill")

	// TEST_SCENARIO: a machine woken inside the episode was not running when the kill happened, so the kill is not what keeps it down: its own reason is what the agent reads.
	_, err = pods.UpdateStatus(ctx, runner, metav1.UpdateOptions{})
	require.NoError(t, err)
	runner.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			Reason: "OOMKilled", FinishedAt: metav1.NewTime(time.Now().Add(-time.Minute)),
		}},
	}}
	_, err = pods.UpdateStatus(ctx, runner, metav1.UpdateOptions{})
	require.NoError(t, err)
	r.vmRunningSince.Store(agent.Name, time.Now())
	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonOOMKilled, Message: "the kernel killed the machine's VMM"}, true))
	assert.Equal(t, vmrunner.ReasonOOMKilled, reason(), "a machine woken inside the episode, whose own boot the kill did not take down")

	// TEST_SCENARIO: a controller that restarts inside the episode knows no start time for an agent it finds running, and a reason it published before that restart says the kill took the agent down: it keeps it to the end of the episode.
	apimeta.SetStatusCondition(&agent.Status.Conditions, metav1.Condition{
		Type: apiv1.ConditionAgentPodReady, Status: metav1.ConditionFalse, Reason: apiv1.ReasonRunnerOutOfMemory,
		LastTransitionTime: metav1.NewTime(time.Now().Add(-time.Minute)),
	})
	r.vmRunningSince.Delete(agent.Name)
	r.vmRecoveredAt.Delete(agent.Name)
	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateRunning, Reason: vmrunner.ReasonOOMKilled, Message: "the kernel killed the machine's VMM"}, true))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, reason(), "a reason published before the controller restarted, with no start behind it")
}

func TestAMachinesSecretsAreReadInTwoRounds(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))
	const delay = 200 * time.Millisecond
	r.client = slowSecretsClient{r.client.(*fake.Clientset), delay}

	started := time.Now()
	_, reached, err := r.reconcileVMAgent(ctx, agent, agentOwnerRef(agent), "10.96.42.42", true, true)
	elapsed := time.Since(started)

	require.NoError(t, err)
	assert.True(t, reached)
	assert.Equal(t, "MITM-CA", node.spec("my-agent").CACert)
	assert.Less(t, elapsed, 3*delay, "the Secrets were read in more than two rounds")
}
