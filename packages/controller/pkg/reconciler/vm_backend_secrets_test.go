// TEST_OVERVIEW: a machine takes only its owner's Secrets, loses a Secret whose ref was refused, and names the kill when its runner was OOM-killed; its Secrets are read in two rounds so the list is one call.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/kubernetes/fake"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_SCENARIO: a secretRef names a Secret by name alone, in the namespace that holds every owner's credentials and every runner's token, and all of its keys land in the guest's environment. A Secret labelled with the Agent's own owner is honoured; one with another owner's label, with no owner label at all, or one the platform manages is refused: the machine is still ensured, without any of its values, and the reconcile reports the refusal.
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

// TEST_SCENARIO: an agent already ran with a Secret its owner does not hold — written before the check existed. Refusing the reconcile alone would leave that environment on the workload; the refusal must take it off. A machine ensured with the Secret is ensured again without it.
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

// TEST_SCENARIO: the container backend hands a secretRef to the kubelet as envFrom, so the same Secret the vm backend refuses must never reach a StatefulSet there either: the pod is rendered without it, which also takes it off a pod that already had it, and the reconcile reports the refusal. An operator's Secret that predates the rule needs only its owner label to work again.
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

// TEST_SCENARIO: the OOM kill of an owner's runner was reported only on the agents whose runner reason happened to be MachineNotReady, so an agent the restarted runner refused room, or one carrying a reason of its own, told its owner about that consequence and never about the kill — and the OOM notice and the Slack alert read nothing else. Every agent whose machine was running when the kill happened now names it for the episode that follows, from the runner pod's last termination and the state the agent was last published in; a reason the runner gives for this machine alone — its boot, its image, the kernel's kill of its VMM — still outranks the pod's, since the pod's kill is no account of what this machine did afterwards.
func TestEveryAgentOfAnOOMKilledRunnerNamesTheKill(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	killed := time.Now().Add(-time.Minute).Truncate(time.Second)
	// TEST_SCENARIO: the agent was up when the kill landed, so its condition predates it.
	require.NoError(t, updateAgentStatus(ctx, r.dynamic, "test-agents", agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionAgentPodReady, true, "PodReady", "", "", agent.Generation)
		setConditionTime(s, apiv1.ConditionAgentPodReady, killed.Add(-time.Hour))
	}))
	killTheRunnerForMemory(t, r, killed)

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
	// TEST_SCENARIO: each publish reads the condition the last one wrote, as a reconciler working from the API would.
	publish := func(st vmrunner.MachineStatus) {
		obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, agent.Name, metav1.GetOptions{})
		require.NoError(t, err)
		read, err := FromCacheObject[apiv1.Agent](obj)
		require.NoError(t, err)
		require.NoError(t, r.publishVMReadiness(ctx, read, st, true))
	}

	publish(vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"})
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, reason(), "an agent refused room after the kill")

	// TEST_SCENARIO: the running machine's own death is a finer answer than the pod's kill, so the pod's does not replace it.
	publish(vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonOOMKilled, Message: "the kernel killed the machine's VMM"})
	assert.Equal(t, vmrunner.ReasonOOMKilled, reason(), "a machine the kernel killed on its own")

	publish(vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	assert.Equal(t, "PodReady", reason(), "an agent that is up again: the notice reads a reason published while it is down")
	// TEST_SCENARIO: the agent answered after the kill, so the episode it opened is over for it: a failure that follows is its own.
	publish(vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonSeccompKilled, Message: "the machine's VMM made a call its seccomp filter forbids"})
	assert.Equal(t, vmrunner.ReasonSeccompKilled, reason(), "a seccomp kill after the agent had been up since the kill")
}

// TEST_SCENARIO: every reconcile of a waking vm agent prepares its owner's runner before it sends the machine spec, and both read Secrets: the runner's token and certificate, and the agent's leaf. Read one after another they were four serial reads; the token and certificate are read side by side, and the leaf beside the runner, so the API server's latency is paid twice.
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
