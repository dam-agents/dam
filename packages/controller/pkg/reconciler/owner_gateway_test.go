package reconciler

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// TEST_OVERVIEW: with virtualization.gateway.perOwner on, an owner's vm Agents share one gateway pod beside the owner's runner, each on a slot of ports recorded on its own gateway Service. The pod and every object it is made of are named after the owner, never after an agent, and go away when the owner's last vm Agent does.

// TEST_SCENARIO: the slot is read back from the agent's own Service, so a reconcile after a controller restart gives every agent the slot it had; a new agent gets the lowest slot nobody holds, which is the gap a deleted agent left.
func TestOwnerGatewaySlot_StableAndLowestFree(t *testing.T) {
	svc := func(agent string, slot int) corev1.Service {
		return corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: GatewayName(agent), Annotations: map[string]string{annOwnerGatewaySlot: strconv.Itoa(slot)}}}
	}
	services := []corev1.Service{svc("a", 0), svc("c", 2)}
	slot, ok := allocateOwnerGatewaySlot("c", services)
	require.True(t, ok)
	assert.Equal(t, 2, slot)
	slot, _ = allocateOwnerGatewaySlot("new", services)
	assert.Equal(t, 1, slot)
	assert.Equal(t, 20002, ownerGatewayProxyPort(1))
	assert.Equal(t, 20003, ownerGatewayResolverPort(1))
}

// TEST_SCENARIO: with the flag off, a vm Agent's reconcile renders no owner gateway object at all, so an install that never switches keeps exactly what it ran before.
func TestOwnerGateway_FlagOffRendersNothing(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(context.Background(), agent))
	deps, err := r.client.AppsV1().Deployments("test-agents").List(context.Background(), metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent})
	require.NoError(t, err)
	assert.Empty(t, deps.Items)
}

// TEST_SCENARIO: with the flag on, an owner gets exactly one owner gateway with its ConfigMap, credential Secret, ServiceAccount and policies, and the agent's gateway Service records its slot, while the agent still routes to its own gateway pod. The agent's harness policy admits the owner gateway's principal, only with the guard's header.
func TestOwnerGateway_FlagOnRendersOneOwnerGateway(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Gateway.PerOwner = true
	require.NoError(t, r.Reconcile(context.Background(), agent))
	require.NoError(t, r.Reconcile(context.Background(), agent))
	ctx, ns := context.Background(), "test-agents"
	name := ownerGatewayName("platform", testOwner)

	deps, err := r.client.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + ownerGatewayComponent})
	require.NoError(t, err)
	require.Len(t, deps.Items, 1)
	dep := deps.Items[0]
	assert.Equal(t, name, dep.Name)
	assert.Equal(t, int32(0), dep.Spec.Strategy.RollingUpdate.MaxUnavailable.IntVal)
	assert.Equal(t, int32(1), dep.Spec.Strategy.RollingUpdate.MaxSurge.IntVal)
	assert.Equal(t, name, dep.Spec.Template.Spec.ServiceAccountName)

	cm, err := r.client.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, cm.Data[ownerGatewayLDSKey], "agent_egress_my-agent")
	assert.Contains(t, cm.Data[machineDNSCorefileKey], ".:20001 {")
	for _, obj := range []func() error{
		func() error {
			_, err := r.client.CoreV1().Secrets(ns).Get(ctx, name+"-credentials", metav1.GetOptions{})
			return err
		},
		func() error {
			_, err := r.client.CoreV1().ServiceAccounts(ns).Get(ctx, name, metav1.GetOptions{})
			return err
		},
		func() error {
			_, err := r.client.NetworkingV1().NetworkPolicies(ns).Get(ctx, name+"-ingress", metav1.GetOptions{})
			return err
		},
		func() error {
			_, err := r.client.NetworkingV1().NetworkPolicies(ns).Get(ctx, name+"-gateway-egress", metav1.GetOptions{})
			return err
		},
	} {
		assert.NoError(t, obj())
	}
	svc, err := r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "0", svc.Annotations[annOwnerGatewaySlot])
	assert.Equal(t, "my-agent", svc.Spec.Selector[LabelPair], "the agent still routes to its own gateway pod")

	policy, err := r.dynamic.Resource(authzPolicyGVR).Namespace("default").Get(ctx, "my-agent-harness-allow", metav1.GetOptions{})
	require.NoError(t, err)
	rules := policy.Object["spec"].(map[string]interface{})["rules"].([]interface{})
	require.Len(t, rules, 2)
	assert.Contains(t, rules[1], "when")
}

// TEST_SCENARIO: the owner gateway lives exactly as long as the owner has a vm Agent: the orphan sweep that finds none left removes it with all its objects.
func TestOwnerGateway_SweptWithTheOwnersLastVMAgent(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Gateway.PerOwner = true
	require.NoError(t, r.Reconcile(context.Background(), agent))
	ctx, ns := context.Background(), "test-agents"
	name := ownerGatewayName("platform", testOwner)
	_, err := r.client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)

	require.NoError(t, r.dynamic.Resource(AgentsGVR).Namespace(ns).Delete(ctx, "my-agent", metav1.DeleteOptions{}))
	r.ReconcileOrphanMachines(ctx)

	_, err = r.client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	assert.Error(t, err)
	_, err = r.client.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
	assert.Error(t, err)
	_, err = r.client.CoreV1().Secrets(ns).Get(ctx, name+"-credentials", metav1.GetOptions{})
	assert.Error(t, err)
	_, err = r.client.CoreV1().ServiceAccounts(ns).Get(ctx, name, metav1.GetOptions{})
	assert.Error(t, err)
}

// TEST_SCENARIO: the cut-over keeps the Service's ClusterIP, which the machine's allowlist and resolver name, and changes only where it points: the owner gateway pod, with every port the Service declares mapped onto the agent's own slot and no other port declared.
func TestOwnerGateway_RetargetMapsOnlyTheAgentsSlot(t *testing.T) {
	svc := BuildGatewayService("agent-a", true, testConfig, metav1.OwnerReference{})
	svc.Spec.ClusterIP = "10.43.0.7"
	moved := retargetedGatewayService(svc, testOwner, 3)
	assert.Equal(t, "10.43.0.7", moved.Spec.ClusterIP)
	assert.Equal(t, map[string]string{"app.kubernetes.io/component": ownerGatewayComponent, envoyOwnerLabel: testOwner}, moved.Spec.Selector)
	require.Len(t, moved.Spec.Ports, len(svc.Spec.Ports))
	for _, p := range moved.Spec.Ports {
		want := ownerGatewayProxyPort(3)
		if p.Name == "dns" || p.Name == "dns-tcp" {
			want = ownerGatewayResolverPort(3)
		}
		assert.Equal(t, want, p.TargetPort.IntValue(), p.Name)
	}
}

func ownerGatewayPod(ip string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "owner-gw-1", Namespace: "test-agents", Labels: map[string]string{"app.kubernetes.io/component": ownerGatewayComponent, envoyOwnerLabel: testOwner}},
		Status:     corev1.PodStatus{PodIP: ip, Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}},
	}
}

// TEST_SCENARIO: an agent moves to its owner gateway only once that pod answers its listener's health path with the revision rendered for it. A stale answer leaves it on its own gateway; the right answer moves it, every later reconcile keeps it moved, and its gateway readiness is then the probe through its own Service: true while current, false with the stale reason when not.
func TestOwnerGateway_CutOverWaitsForTheCurrentListener(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Gateway.PerOwner = true
	answer := "stale"
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		asked = append(asked, req.Host)
		_, _ = w.Write([]byte(answer))
	}))
	t.Cleanup(srv.Close)
	r.ownerProbeClient = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}}}
	ctx, ns := context.Background(), "test-agents"
	_, err := r.client.CoreV1().Pods(ns).Create(ctx, ownerGatewayPod("10.42.0.9"), metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, r.Reconcile(ctx, agent))
	svc, err := r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, svc.Annotations[annOwnerGatewayServed], "a stale listener must not take the agent's traffic")
	assert.Contains(t, asked, "10.42.0.9:20000")

	rev, _ := r.ownerGatewayRevisions.Load("my-agent")
	answer = rev.(string)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, agent))
	svc, err = r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "true", svc.Annotations[annOwnerGatewayServed])
	assert.Equal(t, ownerGatewayComponent, svc.Spec.Selector["app.kubernetes.io/component"], "a later reconcile keeps the agent moved")
	assert.Equal(t, 20000, svc.Spec.Ports[0].TargetPort.IntValue())

	ready, _, _ := r.gatewayReadiness(ctx, agent)
	assert.True(t, ready)
	assert.Contains(t, asked, svc.Spec.ClusterIP+":10000", "after the move readiness is probed through the agent's own Service")
	answer = "older"
	ready, reason, _ := r.gatewayReadiness(ctx, agent)
	assert.False(t, ready)
	assert.Equal(t, apiv1.ReasonOwnerGatewayListenerStale, reason)
}

func servedVMReconciler(t *testing.T) (*AgentReconciler, *fakeNode, *apiv1.Agent) {
	t.Helper()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Gateway.PerOwner = true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		rev, _ := r.ownerGatewayRevisions.Load("my-agent")
		s, _ := rev.(string)
		_, _ = w.Write([]byte(s))
	}))
	t.Cleanup(srv.Close)
	r.ownerProbeClient = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}}}
	_, err := r.client.CoreV1().Pods("test-agents").Create(context.Background(), ownerGatewayPod("10.42.0.9"), metav1.CreateOptions{})
	require.NoError(t, err)
	for range 3 {
		require.NoError(t, r.Reconcile(context.Background(), agent))
	}
	svc, err := r.client.CoreV1().Services("test-agents").Get(context.Background(), GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	require.Equal(t, "true", svc.Annotations[annOwnerGatewayServed])
	return r, node, agent
}

// TEST_SCENARIO: an agent its owner gateway serves hibernates and wakes without its own gateway pod: the idle checker stops the machine and records the agent down on its Service, the agent still reads hibernated only once the machine stopped, and a wake records it up and starts the machine while its own gateway stays at zero. Its listener stays configured the whole time, so a wake needs no configuration change.
func TestOwnerGateway_HibernateAndWakeLeaveTheOwnGatewayAtZero(t *testing.T) {
	ctx := context.Background()
	r, node, agent := servedVMReconciler(t)
	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")), "a served agent's own gateway is not needed")
	up, ok, err := r.servedDesiredUp(ctx, "my-agent")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.True(t, up)

	agent.Annotations[annLastActivity] = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	stored.SetAnnotations(agent.Annotations)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, stored, metav1.UpdateOptions{})
	require.NoError(t, err)
	checker := NewIdleChecker(r.client, r.dynamic, r.config).WithMachineHalt(r.HaltMachine)
	checker.busyProbe = func(context.Context, string) bool { return false }
	checker.check(ctx)
	assert.False(t, node.spec("my-agent").Running)
	up, _, _ = r.servedDesiredUp(ctx, "my-agent")
	assert.False(t, up)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, node.spec("my-agent").Running, "a lapsed idle timeout with the agent recorded down keeps the machine stopped")
	assert.Equal(t, apiv1.ReasonHibernated, readyCondition(t, r, "my-agent").Reason)
	cm, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, cm.Data[ownerGatewayLDSKey], "agent_egress_my-agent", "a hibernated agent keeps its listener")

	agent.Annotations[annLastActivity] = time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.True(t, node.spec("my-agent").Running)
	up, _, _ = r.servedDesiredUp(ctx, "my-agent")
	assert.True(t, up)
	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")), "a wake starts no gateway pod")
}

// TEST_SCENARIO: one release that changes the owner gateway's template would restart every owner's egress at the same moment, so a changed template waits for a place: with one place, the first owner gateway rolls and the second waits until the first has rolled out, then rolls on the next sweep. A gateway whose template is unchanged is never touched.
func TestOwnerGateway_TemplateChangesRollOneOwnerAtATime(t *testing.T) {
	ctx := context.Background()
	r, _ := setupReconciler(t, agentCR())
	r.config.VM = config.VMConfig{Enabled: true, Gateway: config.VMGateway{PerOwner: true}, Runner: config.VMRunnerSpec{Rollout: config.VMRunnerRollout{MaxConcurrent: 1}}}
	for _, owner := range []string{"owner-a", "owner-b"} {
		require.NoError(t, r.applyOwnerGatewayDeployment(ctx, buildOwnerGatewayDeployment(owner, r.config, nil)))
	}
	image := func(owner string) string {
		dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, ownerGatewayName("platform", owner), metav1.GetOptions{})
		require.NoError(t, err)
		return dep.Spec.Template.Spec.Containers[0].Image
	}
	r.config.EnvoyImage = "envoy:next"
	r.rollOwnerGateways(ctx)
	first, second := "owner-a", "owner-b"
	if image(first) != "envoy:next" {
		first, second = second, first
	}
	assert.Equal(t, "envoy:next", image(first))
	assert.NotEqual(t, "envoy:next", image(second), "the second owner waits while the first is mid-roll")
	r.rollOwnerGateways(ctx)
	assert.NotEqual(t, "envoy:next", image(second), "it keeps waiting until the first has rolled out")

	dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, ownerGatewayName("platform", first), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Status = appsv1.DeploymentStatus{ObservedGeneration: dep.Generation, Replicas: 1, UpdatedReplicas: 1, ReadyReplicas: 1}
	_, err = r.client.AppsV1().Deployments(r.config.Namespace).UpdateStatus(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	r.rollOwnerGateways(ctx)
	assert.Equal(t, "envoy:next", image(second))
}

// TEST_SCENARIO: when the owner gateway pod crash-loops, every agent it serves has no gateway, so each one's gateway readiness carries the pod's own reason, the account the UI shows as a failed gateway, rather than a stale listener.
func TestOwnerGateway_ACrashLoopingPodIsEachAgentsGatewayFailure(t *testing.T) {
	ctx := context.Background()
	r, _, agent := servedVMReconciler(t)
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, "owner-gw-1", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.Conditions = nil
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "envoy", State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff", Message: "back-off restarting"}}, LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", ExitCode: 137}}}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	r.ownerProbeClient = &http.Client{Transport: &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { return nil, errors.New("refused") }}}
	ready, reason, _ := r.gatewayReadiness(ctx, agent)
	assert.False(t, ready)
	assert.NotEqual(t, apiv1.ReasonOwnerGatewayListenerStale, reason)
	assert.NotEmpty(t, reason)
}

// TEST_SCENARIO: Envoy exits at once on SIGTERM, so a roll would cut every stream the old pod holds. The old pod sleeps before it is signalled, inside its grace, so streams shorter than the sleep finish on it while the new pod takes new connections.
func TestOwnerGateway_OldPodServesItsStreamsBeforeItStops(t *testing.T) {
	dep := buildOwnerGatewayDeployment(testOwner, testConfig, nil)
	envoy := dep.Spec.Template.Spec.Containers[0]
	require.NotNil(t, envoy.Lifecycle)
	require.NotNil(t, envoy.Lifecycle.PreStop.Sleep)
	assert.Less(t, envoy.Lifecycle.PreStop.Sleep.Seconds, *dep.Spec.Template.Spec.TerminationGracePeriodSeconds)
	assert.GreaterOrEqual(t, envoy.Lifecycle.PreStop.Sleep.Seconds, int64(20))
}
