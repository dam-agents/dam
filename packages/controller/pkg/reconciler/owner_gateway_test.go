package reconciler

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"sigs.k8s.io/yaml"

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

// TEST_SCENARIO: with the flag on, an owner gets exactly one owner gateway with one Secret holding its files and its credentials, ServiceAccount and policies, and the agent's gateway Service records its slot, while the agent still routes to its own gateway pod. The agent's harness policy admits the owner gateway's principal, only with the guard's header.
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
	probe := dep.Spec.Template.Spec.Containers[0].ReadinessProbe
	require.NotNil(t, probe, "the surge holds only if the new pod turns ready once Envoy has loaded the agents' files")
	assert.Equal(t, r.config.EnvoyPort, probe.HTTPGet.Port.IntValue())

	files, err := r.client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, string(files.Data[ownerGatewayLDSKey]), "agent_egress_my-agent")
	assert.Contains(t, string(files.Data[machineDNSCorefileKey]), ".:20001 {")
	assert.Contains(t, string(files.Data[ownerGatewayBootstrap]), "owner_gateway_health")
	for _, obj := range []func() error{
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
	_, err = r.client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
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
	_, err = r.client.CoreV1().Secrets("test-agents").Create(context.Background(), &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: ownerGatewayName("platform", testOwner) + ownerGatewayLeafSuffix, Namespace: "test-agents"},
		Data:       map[string][]byte{"ca.crt": []byte("MITM-CA")},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	for range 3 {
		require.NoError(t, r.Reconcile(context.Background(), agent))
	}
	svc, err := r.client.CoreV1().Services("test-agents").Get(context.Background(), GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	require.Equal(t, "true", svc.Annotations[annOwnerGatewayServed])
	return r, node, agent
}

// TEST_SCENARIO: the owner gateway mounts one Secret for all of the owner's agents, and the kubelet refreshes that mount only when it syncs the pod, as it does an agent's own gateway's. So its pod carries the Secret's content hash, and a new hash syncs it at once and asks one of its agents to come back for the second sync, which a kubelet whose copy of the Secret was still old needs. A pod that is going away is left alone.
func TestOwnerGateway_ACredentialChangeSyncsItsPodTwice(t *testing.T) {
	r, _, _ := servedVMReconciler(t)
	ctx, ns := context.Background(), "test-agents"
	requeued := &requeueLog{}
	r.WithRequeue(t.Context(), requeued.add)
	ownerPod := func() *corev1.Pod {
		pod, err := r.client.CoreV1().Pods(ns).Get(ctx, "owner-gw-1", metav1.GetOptions{})
		require.NoError(t, err)
		return pod
	}

	creds, err := r.client.CoreV1().Secrets(ns).Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, creds.Annotations[annOwnerCredentialsHash], ownerPod().Annotations[annGatewayCredentialsRev], "the owner gateway pod carries the hash of the Secret it mounts")

	now := time.Date(2026, 10, 19, 18, 4, 12, 0, time.UTC)
	r.refreshOwnerGatewayCredentials(ctx, testOwner, "rotated", []string{"my-agent"}, now)
	assert.Equal(t, "rotated", ownerPod().Annotations[annGatewayCredentialsRev])
	assert.Equal(t, []time.Duration{gatewayCredentialsResyncWait}, requeued.all(), "one of its agents comes back for the second sync")

	r.refreshOwnerGatewayCredentials(ctx, testOwner, "rotated", []string{"my-agent"}, now.Add(gatewayCredentialsResyncWait))
	assert.Equal(t, "rotated", ownerPod().Annotations[annGatewayCredentialsResync])

	pod := ownerPod()
	deleting := metav1.NewTime(now)
	pod.DeletionTimestamp = &deleting
	_, err = r.client.CoreV1().Pods(ns).Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	r.refreshOwnerGatewayCredentials(ctx, testOwner, "next", []string{"my-agent"}, now.Add(time.Minute))
	assert.Equal(t, "rotated", ownerPod().Annotations[annGatewayCredentialsRev], "a pod going away is not synced")
}

// TEST_SCENARIO: the failure of the vm lane was two volumes. Envoy read the file naming a new signing credential while the Secret that holds it had not been projected yet, built the provider, and the provider never read its file again; the listener was accepted, so the health path answered the current revision and nothing the controller reads said the agent was unsigned. The owner gateway's files and the connections' credentials are therefore one Secret mounted as one volume, which the kubelet flips once: a listener that names a credential and the credential itself become visible together, and no provider is built in the gap.
func TestOwnerGateway_ItsFilesAndItsCredentialsAreOneVolume(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Gateway.PerOwner = true
	ctx, ns := context.Background(), "test-agents"
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, agent))
	name := ownerGatewayName("platform", testOwner)

	dep, err := r.client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	var sources []corev1.VolumeSource
	for _, volume := range dep.Spec.Template.Spec.Volumes {
		if volume.ConfigMap != nil {
			t.Fatalf("volume %s is a ConfigMap, so its keys reach the pod on a projection of their own", volume.Name)
		}
		if volume.Secret != nil {
			sources = append(sources, volume.VolumeSource)
		}
	}
	files, err := r.client.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, string(files.Data[ownerGatewayLDSKey]), "tls_inspect_internal_my-agent", "the listener file lives in the Secret")

	// TEST_SCENARIO: every file the render names is a key of that one Secret, so the pod that reads a listener has its credential beside it.
	rendered, err := renderOwnerGateway([]ownerGatewayAgent{{Name: "my-agent", ProxyPort: 20000, Chains: chainsFromSecrets([]corev1.Secret{signingSecret("platform-conn-cos", "conn-cos", "s3.example.cloud")}, nil)}}, r.config, nil)
	require.NoError(t, err)
	credential := credentialFileOf(t, rendered.LDS)
	require.NotEmpty(t, credential)
	assert.Equal(t, envoyBootstrapMount, path.Dir(credential), "the credential is a file of the one directory the pod mounts")
	names := make([]string, 0, len(sources))
	for _, source := range sources {
		names = append(names, source.Secret.SecretName)
	}
	assert.Contains(t, names, name, "and of a volume the pod mounts")
}

// TEST_SCENARIO: an offer re-offers what the pod refused without replacing what it took: the files carry a new version, and every listener and cluster in them is byte-identical, so Envoy deduplicates them and no stream is drained for a repair.
func TestOwnerGateway_AnOfferMovesOnlyTheVersion(t *testing.T) {
	cfg := telemetryTestCfg()
	agents := []ownerGatewayAgent{
		{Name: "agent-signed", ProxyPort: 20000, Chains: chainsFromSecrets([]corev1.Secret{signingSecret("platform-conn-cos", "conn-cos", "s3.example.cloud")}, nil)},
		{Name: "agent-injected", ProxyPort: 20002, Chains: ownerTestAgents()[0].Chains},
	}
	plain, err := renderOwnerGateway(agents, cfg, nil)
	require.NoError(t, err)
	offered, err := renderOwnerGateway(agents, cfg, &ownerGatewayRepairPlan{version: ownerGatewayTemplateRev + "-repair-1"})
	require.NoError(t, err)

	assert.Equal(t, "o1-owner-gateway-repair-1", ownerGatewayLDSVersion(t, offered.LDS), "the files move, so the pod reads them again")
	assert.Equal(t, plain.Revisions, offered.Revisions, "the revision a health path answers is what was rendered, not how often it was sent")
	assert.Equal(t, resourcesOf(t, plain.LDS), resourcesOf(t, offered.LDS), "every listener is the one Envoy already has")
	assert.Equal(t, resourcesOf(t, plain.CDS), resourcesOf(t, offered.CDS))
	assert.Equal(t, plain.Bootstrap, offered.Bootstrap)
}

// UNIT_BOUNDARY_DESCRIPTION: the path a listener names for the credential its chain signs with, from the rendered listener file.
func credentialFileOf(t *testing.T, lds string) string {
	t.Helper()
	for _, listener := range resourcesOf(t, lds) {
		var file string
		var walk func(v any)
		walk = func(v any) {
			switch v := v.(type) {
			case map[string]any:
				if source, ok := v["credentials_data_source"].(map[string]any); ok && file == "" {
					file, _ = source["filename"].(string)
				}
				for _, nested := range v {
					walk(nested)
				}
			case []any:
				for _, nested := range v {
					walk(nested)
				}
			}
		}
		walk(listener)
		if file != "" {
			return file
		}
	}
	return ""
}

func ownerGatewayLDSVersion(t *testing.T, lds string) string {
	t.Helper()
	var parsed struct {
		Version string `json:"version_info"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(lds), &parsed))
	return parsed.Version
}

// TEST_SCENARIO: what an owner writes is decided by an answer it recorded, not by the absence of a marker: an agent whose rendering the pod has not answered is owed the files again on a doubling wait, one that answered is owed them once more, and the waits are bounded. A sleeping agent is never probed and a controller that restarted has recorded nothing, so both take the same wait; neither is ever read as a receipt.
func TestOwnerGatewayRepairPlan_AnAgentIsOwedWhatItsOwnAnswerSays(t *testing.T) {
	start := time.Date(2026, 10, 20, 3, 0, 0, 0, time.UTC)
	r := &AgentReconciler{}
	names := []string{"agent-a", "agent-b"}
	r.ownerGatewayRevisions.Store("agent-a", "rev-1")
	r.ownerGatewayRevisions.Store("agent-b", "rev-1")
	planAt := func(after time.Duration) *ownerGatewayRepairPlan {
		return r.ownerGatewayRepairPlan(testOwner, names, start.Add(after))
	}

	// TEST_SCENARIO: an unobserved rendering is written once, then again on a doubling wait, and the waits end after a bounded number of tries.
	first := planAt(0)
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", first.xdsVersion(), "the files move, so the pod reads them again")
	assert.Equal(t, ownerGatewayOfferWait, first.due["agent-a"], "no answer, so another offer is a wait away")
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", planAt(time.Second).xdsVersion(), "and nothing is written inside the wait")
	at := ownerGatewayOfferWait
	plan := planAt(at)
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-2", plan.xdsVersion())
	assert.Equal(t, 2*ownerGatewayOfferWait, plan.due["agent-a"], "then two waits after that")
	for plan.due["agent-a"] > 0 {
		at += plan.due["agent-a"]
		plan = planAt(at)
	}
	assert.Equal(t, ownerGatewayTemplateRev+fmt.Sprintf("-repair-%d", ownerGatewayOfferTries), plan.xdsVersion(), "the tries are bounded")
	assert.GreaterOrEqual(t, at, 90*time.Second, "the last offer is past a kubelet's sync period plus its cache delay")
	assert.Zero(t, plan.due["agent-a"], "and a rendering that will not load is not rewritten for as long as the agent lives")

	// TEST_SCENARIO: an agent whose rendering the pod answered is offered the files once more, and a second apply of the same answer writes nothing.
	r = &AgentReconciler{}
	r.ownerGatewayRevisions.Store("agent-a", "rev-1")
	r.ownerGatewayAnswered.Store("agent-a", "rev-1")
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", r.ownerGatewayRepairPlan(testOwner, []string{"agent-a"}, start).xdsVersion(), "the answer is the receipt, and the files are offered again after it")
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", r.ownerGatewayRepairPlan(testOwner, []string{"agent-a"}, start.Add(time.Second)).xdsVersion(), "the offer is spent once")

	// TEST_SCENARIO: an answer to an older rendering, a controller with no recorded answer, and a sleeping agent are all unobserved, and none of them is a receipt.
	for _, answer := range []string{"", "rev-0"} {
		r = &AgentReconciler{}
		r.ownerGatewayRevisions.Store("agent-a", "rev-1")
		if answer != "" {
			r.ownerGatewayAnswered.Store("agent-a", answer)
		}
		plan = r.ownerGatewayRepairPlan(testOwner, []string{"agent-a"}, start)
		assert.Equal(t, ownerGatewayOfferWait, plan.due["agent-a"], "only an answer to this rendering counts, not the absence of a stale mark")
		assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", plan.xdsVersion())
	}

	// TEST_SCENARIO: one write carries every agent owed one, whatever their number, and no two writes land closer than the pace.
	r = &AgentReconciler{}
	var many []string
	for i := range 20 {
		name := fmt.Sprintf("agent-%02d", i)
		many = append(many, name)
		r.ownerGatewayRevisions.Store(name, "rev-1")
	}
	now := start
	plan = r.ownerGatewayRepairPlan(testOwner, many, now)
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", plan.xdsVersion())
	assert.NotEmpty(t, plan.due, "twenty agents wait on one pace, not twenty writes")
	plan = r.ownerGatewayRepairPlan(testOwner, many, now.Add(ownerGatewayOfferWait))
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-2", plan.xdsVersion(), "and the next offer is one write for all of them")

	// TEST_SCENARIO: a new rendering of an agent is a fresh offer, so a credential file it names is never repaired on the leftovers of an older one.
	r = &AgentReconciler{}
	r.ownerGatewayRevisions.Store("agent-a", "rev-1")
	r.ownerGatewayAnswered.Store("agent-a", "rev-1")
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", r.ownerGatewayRepairPlan(testOwner, []string{"agent-a"}, start).xdsVersion())
	r.ownerGatewayRevisions.Store("agent-a", "rev-2")
	now = start.Add(ownerGatewayWritePace)
	plan = r.ownerGatewayRepairPlan(testOwner, []string{"agent-a"}, now)
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-2", plan.xdsVersion(), "a new rendering is offered the files")
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-2", r.ownerGatewayRepairPlan(testOwner, []string{"agent-a"}, now).xdsVersion(), "and once only")
}

// TEST_SCENARIO: a credential file the pod has never been written can reach a listener one flip before the kubelet publishes that file's own pathname, so a provider built then reads a path that is not there and never reads again. The arrival is counted, and the agent that answers the render carrying it is given one internal-listener generation, which is the only thing that builds that provider again; a rotation of a file the pod already had is no arrival and costs no generation.
func TestOwnerGatewayRepairPlan_ACredentialArrivalRecreatesTheAgentsListener(t *testing.T) {
	start := time.Date(2026, 10, 20, 3, 0, 0, 0, time.UTC)
	cos, news := "platform-conn-cos.aws-credentials", "platform-conn-new.aws-credentials"
	r := &AgentReconciler{}
	names := []string{"agent-a"}
	write := func(after time.Duration, revision string, keys []string) *ownerGatewayRepairPlan {
		r.ownerGatewayRevisions.Store("agent-a", revision)
		r.ownerGatewayAnswered.Store("agent-a", revision)
		plan := r.ownerGatewayRepairPlan(testOwner, names, start.Add(after))
		plan.observeCredentials(keys)
		plan.committed()
		return plan
	}

	// TEST_SCENARIO: the first applied render records the credential files the pod already has as the baseline, so nothing is regenerated for them.
	first := write(0, "rev-1", []string{cos})
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", first.xdsVersion())
	assert.Zero(t, first.generation("agent-a"), "the files the pod already had need no generation")

	// TEST_SCENARIO: a revoked credential file leaves the render, and a key that goes is no arrival: its pathname was there, and its provider went with its chain, so no listener is replaced for it.
	revoked := write(2*time.Second, "rev-2", nil)
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-2", revoked.xdsVersion(), "the revocation is written")
	assert.Zero(t, revoked.generation("agent-a"), "a key that leaves is not one the pod never had")

	// TEST_SCENARIO: a key that comes back is a pathname the pod no longer has, so it counts as an arrival, and its generation is spent only after the agent answered the render that carried it.
	returned := write(4*time.Second, "rev-3", []string{cos})
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-3", returned.xdsVersion())
	assert.Zero(t, returned.generation("agent-a"), "the returning key is written first, unobserved")
	regenerated := write(6*time.Second, "rev-3", []string{cos})
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-4", regenerated.xdsVersion())
	assert.Equal(t, 1, regenerated.generation("agent-a"), "the agent that answered is given one generation, so its provider is built again")

	// TEST_SCENARIO: a file the pod was already written, rotated in place, is read rather than rebuilt, and a settled owner writes nothing more.
	rotated := r.ownerGatewayRepairPlan(testOwner, names, start.Add(8*time.Second))
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-4", rotated.xdsVersion(), "nothing is owed, so nothing is written")
	assert.Equal(t, 1, rotated.generation("agent-a"), "the generation it carries stays, and no other is owed")

	// TEST_SCENARIO: a credential file the pod has never been written is repaired only once the agent answers a render that carried it, so its pathname exists by the time the provider is built again.
	fresh := write(10*time.Second, "rev-4", []string{cos, news})
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-5", fresh.xdsVersion())
	assert.Equal(t, 1, fresh.generation("agent-a"), "the arrival is written first, unobserved")
	arrived := write(12*time.Second, "rev-4", []string{cos, news})
	assert.Equal(t, ownerGatewayTemplateRev+"-repair-6", arrived.xdsVersion())
	assert.Equal(t, 2, arrived.generation("agent-a"), "and the move it carries is above the last one, so that listener is replaced")
}

// TEST_SCENARIO: the same through the reconcile loop: a rendering the pod read is offered once more, one Secret update carries it, and every later reconcile with the same rendering and the same answer writes nothing.
func TestOwnerGateway_ARenderingIsOfferedOnceThroughTheReconcile(t *testing.T) {
	ctx := context.Background()
	r, _, agent := servedVMReconciler(t)
	now := time.Now()
	r.clock = func() time.Time { return now }
	updates := func() int {
		n := 0
		for _, a := range r.client.(*fake.Clientset).Actions() {
			updated, ok := a.(k8stesting.UpdateAction)
			if !ok || a.GetResource().Resource != "secrets" {
				continue
			}
			if secret, ok := updated.GetObject().(*corev1.Secret); ok && secret.Name == ownerGatewayName("platform", testOwner) {
				n++
			}
		}
		return n
	}
	files := func() string {
		got, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		return ownerGatewayLDSVersion(t, string(got.Data[ownerGatewayLDSKey]))
	}

	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, agent))
	settled := updates()
	assert.Contains(t, files(), "-repair-", "the rendering the pod read was offered again")
	for range 3 {
		now = now.Add(time.Minute)
		require.NoError(t, r.Reconcile(ctx, agent))
	}
	assert.Equal(t, settled, updates(), "a settled rendering writes nothing more")
}

// TEST_SCENARIO: an agent its owner gateway serves hibernates and wakes without its own gateway pod: the idle checker stops the machine and records the agent down on its Service, the agent still reads hibernated only once the machine stopped, and a wake records it up and starts the machine while its own gateway stays at zero. Its listener stays configured the whole time, so a wake needs no configuration change.
func TestOwnerGateway_HibernateAndWakeLeaveTheOwnGatewayAtZero(t *testing.T) {
	ctx := context.Background()
	r, node, agent := servedVMReconciler(t)
	_, err := r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a served agent's own gateway is removed")
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
	files, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, string(files.Data[ownerGatewayLDSKey]), "agent_egress_my-agent", "a hibernated agent keeps its listener")

	agent.Annotations[annLastActivity] = time.Now().UTC().Format(time.RFC3339)
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.True(t, node.spec("my-agent").Running)
	up, _, _ = r.servedDesiredUp(ctx, "my-agent")
	assert.True(t, up)
	_, err = r.client.AppsV1().StatefulSets("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "a wake starts no gateway pod")
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

// TEST_SCENARIO: an owner gateway rolls under the runner roll's width, so a share stated there widths the gateways too: with half of four owners as the width, two roll and two wait, where `maxConcurrent: 1` would move them one at a time.
func TestOwnerGateway_TemplateChangesRollTheWidthOfTheShare(t *testing.T) {
	ctx := context.Background()
	r, _ := setupReconciler(t, agentCR())
	r.config.VM = config.VMConfig{Enabled: true, Gateway: config.VMGateway{PerOwner: true}, Runner: config.VMRunnerSpec{Rollout: config.VMRunnerRollout{MaxConcurrent: 1, MaxConcurrentPercent: 50}}}
	owners := []string{"owner-a", "owner-b", "owner-c", "owner-d"}
	for _, owner := range owners {
		require.NoError(t, r.applyOwnerGatewayDeployment(ctx, buildOwnerGatewayDeployment(owner, r.config, nil)))
	}
	r.config.EnvoyImage = "envoy:next"
	r.rollOwnerGateways(ctx)

	rolled := 0
	for _, owner := range owners {
		dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, ownerGatewayName("platform", owner), metav1.GetOptions{})
		require.NoError(t, err)
		if dep.Spec.Template.Spec.Containers[0].Image == "envoy:next" {
			rolled++
		}
	}
	assert.Equal(t, 2, rolled, "half of four owners roll at once under the share, and the rest wait")
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

// TEST_SCENARIO: once its owner gateway serves an agent, the agent's own gateway objects are removed and its policies admit only the owner gateway. Its gateway Service, with the same ClusterIP, and its ext-authz Service stay, so the machine keeps its allowlist and the api-server keeps knowing the agent. Turning the flag off renders the own gateway again, and the agent moves back only once that pod is ready, after which its owner gateway no longer lists it.
func TestOwnerGateway_MigrationRemovesTheOwnGatewayAndRollsBack(t *testing.T) {
	ctx, ns := context.Background(), "test-agents"
	r, _, agent := servedVMReconciler(t)
	before, err := r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	for _, get := range []func() error{
		func() error {
			_, err := r.client.CoreV1().ConfigMaps(ns).Get(ctx, EnvoyBootstrapName("my-agent"), metav1.GetOptions{})
			return err
		},
		func() error {
			_, err := r.client.CoreV1().ServiceAccounts(ns).Get(ctx, "my-agent", metav1.GetOptions{})
			return err
		},
		func() error {
			_, err := r.client.CoreV1().Secrets(ns).Get(ctx, EnvoyLeafSecretName("my-agent"), metav1.GetOptions{})
			return err
		},
		func() error {
			_, err := r.client.NetworkingV1().NetworkPolicies(ns).Get(ctx, "my-agent-gateway-ingress", metav1.GetOptions{})
			return err
		},
	} {
		assert.True(t, k8serrors.IsNotFound(get()))
	}
	policy, err := r.dynamic.Resource(authzPolicyGVR).Namespace("default").Get(ctx, "my-agent-harness-allow", metav1.GetOptions{})
	require.NoError(t, err)
	rules := policy.Object["spec"].(map[string]interface{})["rules"].([]interface{})
	require.Len(t, rules, 1, "only the owner gateway is admitted")
	assert.Contains(t, rules[0], "when")
	_, err = r.client.CoreV1().Services("default").Get(ctx, r.config.ExtAuthzServiceName("my-agent"), metav1.GetOptions{})
	assert.NoError(t, err)

	r.config.VM.Gateway.PerOwner = false
	require.NoError(t, r.Reconcile(ctx, agent))
	svc, err := r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, ownerGatewayComponent, svc.Spec.Selector["app.kubernetes.io/component"], "the agent stays on its owner gateway until its own gateway is ready")
	_, err = r.client.AppsV1().StatefulSets(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "the own gateway is rendered again")
	for _, name := range []string{"my-agent-harness-allow", "my-agent-extauthz-allow"} {
		policy, err := r.dynamic.Resource(authzPolicyGVR).Namespace("default").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Len(t, policy.Object["spec"].(map[string]interface{})["rules"], 2, "%s admits the agent and, while its Service still selects it, the owner gateway", name)
	}

	markGatewayPodReady(t, r, "my-agent")
	require.NoError(t, r.Reconcile(ctx, agent))
	svc, err = r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", svc.Spec.Selector[LabelPair])
	assert.Equal(t, before.Spec.ClusterIP, svc.Spec.ClusterIP)
	assert.Empty(t, svc.Annotations[annOwnerGatewayServed])
	assert.Equal(t, 10000, svc.Spec.Ports[0].TargetPort.IntValue())
	_, err = r.client.AppsV1().Deployments(ns).Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "an owner gateway no agent is left on is removed with its copy of the credentials")
	_, err = r.client.CoreV1().Secrets(ns).Get(ctx, ownerGatewayName("platform", testOwner)+"-credentials", metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err))
}

// TEST_SCENARIO: an owner whose configuration outgrows one ConfigMap after its agents moved is refused: its moved agents get their own gateways back and move back once those are ready, the same way as with the flag off, and the owner gateway goes once none is left on it, rather than serving them a configuration that no longer changes.
func TestOwnerGateway_RefusedOwnerMovesItsAgentsBack(t *testing.T) {
	ctx, ns := context.Background(), "test-agents"
	r, _, agent := servedVMReconciler(t)
	r.ownerGatewayBudget = 1
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, r.ownerGatewayOn(testOwner))
	require.NoError(t, r.Reconcile(ctx, agent))
	_, err := r.client.AppsV1().StatefulSets(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err, "the refused agent's own gateway is rendered again")
	svc, err := r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, ownerGatewayComponent, svc.Spec.Selector["app.kubernetes.io/component"], "the agent stays on its owner gateway until its own gateway is ready")

	markGatewayPodReady(t, r, "my-agent")
	require.NoError(t, r.Reconcile(ctx, agent))
	svc, err = r.client.CoreV1().Services(ns).Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "my-agent", svc.Spec.Selector[LabelPair])
	_, err = r.client.AppsV1().Deployments(ns).Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err))
}

func markGatewayPodReady(t *testing.T, r *AgentReconciler, agent string) {
	t.Helper()
	ctx, ns := context.Background(), "test-agents"
	ss, err := r.client.AppsV1().StatefulSets(ns).Get(ctx, GatewayName(agent), metav1.GetOptions{})
	require.NoError(t, err)
	ss.Status = appsv1.StatefulSetStatus{ObservedGeneration: ss.Generation, UpdateRevision: "rev-1"}
	_, err = r.client.AppsV1().StatefulSets(ns).UpdateStatus(ctx, ss, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Pods(ns).Create(ctx, &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName(agent) + "-0", Namespace: ns, Labels: map[string]string{"controller-revision-hash": "rev-1"}},
		Status:     corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Secrets(ns).Create(ctx, &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: EnvoyLeafSecretName(agent), Namespace: ns},
		Data:       map[string][]byte{"ca.crt": []byte("MITM-CA")},
	}, metav1.CreateOptions{})
	require.NoError(t, err, "a gateway pod starts only once its leaf is issued")
}

// TEST_SCENARIO: a share of a fleet that shrinks can be smaller than the number of gateways still mid-roll, so every broken gateway would wait on the others for a corrective template change that never comes. A gateway already mid-roll takes the change in the place it holds.
func TestOwnerGateway_AMidRollGatewayTakesACorrectiveChangeWhenTheFleetShrinks(t *testing.T) {
	ctx := context.Background()
	r, _ := setupReconciler(t, agentCR())
	r.config.VM = config.VMConfig{Enabled: true, Gateway: config.VMGateway{PerOwner: true}, Runner: config.VMRunnerSpec{Rollout: config.VMRunnerRollout{MaxConcurrent: 1, MaxConcurrentPercent: 50}}}
	owners := []string{"owner-a", "owner-b", "owner-c", "owner-d", "owner-e"}
	for _, owner := range owners {
		require.NoError(t, r.applyOwnerGatewayDeployment(ctx, buildOwnerGatewayDeployment(owner, r.config, nil)))
	}
	r.config.EnvoyImage = "envoy:next"
	r.rollOwnerGateways(ctx)

	var broken, idle []string
	for _, owner := range owners {
		dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, ownerGatewayName("platform", owner), metav1.GetOptions{})
		require.NoError(t, err)
		if dep.Spec.Template.Spec.Containers[0].Image == "envoy:next" {
			broken = append(broken, owner)
		} else {
			idle = append(idle, owner)
		}
	}
	require.Len(t, broken, 3, "half of five rounds up to three, and their pods never became ready")
	for _, owner := range idle {
		require.NoError(t, r.client.AppsV1().Deployments(r.config.Namespace).Delete(ctx, ownerGatewayName("platform", owner), metav1.DeleteOptions{}))
	}
	old := time.Now().Add(-time.Hour)
	for _, owner := range broken {
		dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, ownerGatewayName("platform", owner), metav1.GetOptions{})
		require.NoError(t, err)
		metav1.SetMetaDataAnnotation(&dep.ObjectMeta, annRunnerRolledAt, old.UTC().Format(time.RFC3339))
		_, err = r.client.AppsV1().Deployments(r.config.Namespace).Update(ctx, dep, metav1.UpdateOptions{})
		require.NoError(t, err)
	}

	r.config.EnvoyImage = "envoy:next-again"
	r.rollOwnerGateways(ctx)

	for _, owner := range broken {
		dep, err := r.client.AppsV1().Deployments(r.config.Namespace).Get(ctx, ownerGatewayName("platform", owner), metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, "envoy:next-again", dep.Spec.Template.Spec.Containers[0].Image, "a gateway mid-roll takes the change in the place it holds, where a share of a shrunken fleet would hold all three back")
	}
}

// TEST_SCENARIO: one Secret holds a gateway's files and the credentials its chains sign with, and the resolver container reads one file of it. It is handed a volume of its own that projects that key alone, so a process in that container cannot read a signing key from its filesystem, and the gateway's own volume still carries everything.
func TestOwnerGateway_TheResolverCannotReadTheCredentials(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Gateway.PerOwner = true
	ctx, ns := context.Background(), "test-agents"
	require.NoError(t, r.Reconcile(ctx, agent))
	dep, err := r.client.AppsV1().Deployments(ns).Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	volumes := map[string]corev1.Volume{}
	for _, volume := range dep.Spec.Template.Spec.Volumes {
		volumes[volume.Name] = volume
	}
	var resolver, gateway []corev1.VolumeMount
	for _, container := range dep.Spec.Template.Spec.Containers {
		switch container.Name {
		case "machine-dns":
			resolver = container.VolumeMounts
		case "envoy":
			gateway = container.VolumeMounts
		}
	}
	require.Len(t, resolver, 1, "the resolver mounts one volume")
	projected := volumes[resolver[0].Name]
	require.NotNil(t, projected.Secret)
	assert.Equal(t, []corev1.KeyToPath{{Key: machineDNSCorefileKey, Path: machineDNSCorefileKey}}, projected.Secret.Items, "that mounts the Corefile alone")
	for _, mount := range gateway {
		if mount.MountPath == envoyBootstrapMount {
			assert.Empty(t, volumes[mount.Name].Secret.Items, "the gateway mounts the whole Secret")
		}
	}
}

// TEST_SCENARIO: the startup rollout sweep is the only reconcile an owner whose agents all sleep gets, and it used to move an old-layout Deployment onto a files Secret nothing had written yet, so the new pod waited on a mount that did not exist while it held the roll budget for every other owner. The sweep renders the gateway now, so the Secret exists before the template that mounts it, and an owner whose combined files are past the limit is refused there too, which leaves its old Deployment and the objects its pod mounts alone.
func TestOwnerGatewaySweep_RendersTheFilesBeforeTheTemplate(t *testing.T) {
	ctx := context.Background()
	name, ns := ownerGatewayName("platform", testOwner), "test-agents"
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Gateway.PerOwner = true
	_, err := r.client.AppsV1().Deployments(ns).Create(ctx, &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: map[string]string{"app.kubernetes.io/component": ownerGatewayComponent, envoyOwnerLabel: testOwner}},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Volumes: []corev1.Volume{
			{Name: "config", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: name}}}},
		}}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	r.rollOwnerGateways(ctx)

	// TEST_SCENARIO: the files Secret is written first, so the template that mounts it can pull its pod.
	created := false
	for _, action := range r.client.(*fake.Clientset).Actions() {
		verb, resource := action.GetVerb(), action.GetResource().Resource
		if resource == "secrets" && verb == "create" {
			created = true
		}
		if resource == "deployments" && verb == "update" {
			require.True(t, created, "the Deployment moved to a Secret before that Secret existed")
		}
	}
	require.True(t, created, "the sweep wrote the files")
}

// TEST_SCENARIO: an owner whose old ConfigMap and credentials Secret fit their own limits but whose one Secret does not is refused, and the sweep must not move its Deployment onto files it cannot have: its agents keep the pod that serves them until each moves back.
func TestOwnerGatewaySweep_ARefusedOwnerIsNotRolled(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	name, ns := ownerGatewayName("platform", testOwner), "test-agents"
	r.ownerGatewayBudget = 1
	before := len(r.client.(*fake.Clientset).Actions())

	r.rollOwnerGateways(ctx)

	writes := 0
	for _, action := range r.client.(*fake.Clientset).Actions()[before:] {
		verb, resource := action.GetVerb(), action.GetResource().Resource
		if resource == "deployments" && verb == "update" {
			writes++
		}
		if resource == "secrets" && (verb == "update" || verb == "create") {
			writes++
		}
	}
	assert.Zero(t, writes, "a refused owner is rolled onto nothing and written nothing, so its state cannot advance either")
	r.rollOwnerGateways(ctx)
	again := 0
	for _, action := range r.client.(*fake.Clientset).Actions()[before:] {
		verb, resource := action.GetVerb(), action.GetResource().Resource
		if (resource == "deployments" || resource == "secrets") && (verb == "update" || verb == "create") {
			again++
		}
	}
	assert.Zero(t, again, "and a second sweep adds nothing, so refusals do not accumulate")
	dep, err := r.client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, dep.Spec.Template.Spec.Volumes, "and the Deployment that serves its agents is still there")
}
