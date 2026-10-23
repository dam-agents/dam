package reconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"
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

// TEST_SCENARIO: the repair state is the two numbers the Secret carries, so an agent whose credential key set has not moved and whose listener was rebuilt for its last arrival owes nothing, however often the owner is reconciled.
func TestOwnerGatewayRepairPlan_ASettledOwnerOwesNothing(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	held := map[string][]string{"my-agent": {cos}}

	first := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, nil, time.Now())
	require.True(t, first.newArrival["my-agent"], "the first render that names a key is that agent's first arrival")
	assert.Equal(t, 1, first.arrivedOf("my-agent"))
	assert.Zero(t, first.generation("my-agent"), "and nothing rebuilds for it yet")

	first.adopt(r.ownerGatewayOffersFor(testOwner), nil)
	settled := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, nil, time.Now())
	assert.Equal(t, 1, settled.arrivedOf("my-agent"), "the epoch it arrived at stays")
	assert.False(t, settled.newArrival["my-agent"], "and the same key set is no second arrival")
}

// TEST_SCENARIO: an arrival is the agent's own credential key set moving, so a removal is one: the render projects a chain that no longer names the key, and that chain's provider has to be built again to forget it. The rebuild is one write and then the owner is settled.
func TestOwnerGatewayRepairPlan_ARemovalIsAnArrivalToo(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	both := map[string][]string{"my-agent": {cos, "platform-conn-two.aws-credentials"}}
	one := map[string][]string{"my-agent": {cos}}

	start := r.ownerGatewayRepairPlan(testOwner, both, []string{cos, "platform-conn-two.aws-credentials"}, nil, time.Now())
	start.adopt(set, nil)
	removed := r.ownerGatewayRepairPlan(testOwner, one, []string{cos}, nil, time.Now())
	assert.True(t, removed.newArrival["my-agent"], "the key that left moves the agent's own set")
	assert.Equal(t, 2, removed.arrivedOf("my-agent"))
}

// TEST_SCENARIO: a key a sibling already published is still an arrival for the agent just granted it. The pod may deliver the sibling's write and this one in a single flip, so the agent's listener is built naming a pathname that appears in that same flip, which is the failure being repaired.
func TestOwnerGatewayRepairPlan_ASharedKeyIsAnArrivalForTheAgentGrantedIt(t *testing.T) {
	shared := "platform-conn-shared.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	onlyB := map[string][]string{"my-agent": {}, "agent-b": {shared}}

	published := r.ownerGatewayRepairPlan(testOwner, onlyB, []string{shared}, nil, time.Now())
	published.adopt(set, nil)
	both := map[string][]string{"my-agent": {shared}, "agent-b": {shared}}
	joined := r.ownerGatewayRepairPlan(testOwner, both, []string{shared}, nil, time.Now())
	assert.True(t, joined.newArrival["my-agent"], "the key is new to this agent even though the Secret already carried it")
	assert.False(t, joined.newArrival["agent-b"], "and it is nothing to the agent that already named it")
}

// TEST_SCENARIO: a repair never shares a write with an arrival. The write that publishes a key is the flip whose gap builds the broken provider, so a member that arrived in this plan keeps its debt even when it already answered the revision it is being given.
func TestOwnerGatewayRepairPlan_AnArrivalIsNeverRepairedInItsOwnWrite(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	held := map[string][]string{"my-agent": {cos}}

	start := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, nil, time.Now())
	start.adopt(set, nil)
	// TEST_SCENARIO: the agent answered the revision this render will carry, which is the strongest possible evidence, and it still does not repair: this is the arrival's own write.
	r.ownerGatewayRevisions.Store("my-agent", "rev-arrival")
	r.ownerGatewayEpochs.Store("my-agent", 1)
	r.ownerGatewayAnswered.Store("my-agent", "rev-arrival")
	held["my-agent"] = []string{cos, "platform-conn-new.aws-credentials"}
	// TEST_SCENARIO: the fresh receipt for this very revision, and the arrival still wins: a repair never shares the write that publishes the key.
	arriving := r.ownerGatewayRepairPlan(testOwner, held, []string{cos, "platform-conn-new.aws-credentials"}, map[string]string{"my-agent": "rev-arrival"}, time.Now())
	require.True(t, arriving.newArrival["my-agent"])
	assert.Zero(t, arriving.generation("my-agent"), "the arrival's own write carries no rebuild")
}

// TEST_SCENARIO: an answer kept from before the arrival cannot authorise the repair, even when the rendering has returned to the same content hash. Revoking the key and granting it again produces the same resources, but a later epoch, so the health revision differs and the old answer no longer matches it.
func TestOwnerGatewayRepairPlan_ARegrantIsNotRepairedOnTheOldAnswer(t *testing.T) {
	cos, other := "platform-conn-cos.aws-credentials", "platform-conn-other.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	settled := map[string][]string{"my-agent": {cos, other}}

	start := r.ownerGatewayRepairPlan(testOwner, settled, []string{cos, other}, nil, time.Now())
	start.adopt(set, nil)
	r.ownerGatewayRevisions.Store("my-agent", "rev-1")
	r.ownerGatewayEpochs.Store("my-agent", 1)
	r.ownerGatewayAnswered.Store("my-agent", "rev-1")
	repaired := r.ownerGatewayRepairPlan(testOwner, settled, []string{cos, other}, map[string]string{"my-agent": "rev-1"}, time.Now())
	require.Equal(t, 1, repaired.generation("my-agent"), "the agent repaired for its arrival")

	// TEST_SCENARIO: revoke one key, keeping the other, and grant it back: the resources this agent reads are the ones it had before.
	revoked := map[string][]string{"my-agent": {other}}
	revoking := r.ownerGatewayRepairPlan(testOwner, revoked, []string{other}, nil, time.Now())
	require.True(t, revoking.newArrival["my-agent"])
	revoking.adopt(set, nil)
	regranting := r.ownerGatewayRepairPlan(testOwner, settled, []string{cos, other}, nil, time.Now())
	require.True(t, regranting.newArrival["my-agent"], "the regrant is an arrival again")

	// TEST_SCENARIO: and the answer from before the revocation is still recorded against a revision whose epoch is the old one, so the render after the regrant does not spend it.
	// TEST_SCENARIO: and a receipt for that same revision, taken fresh this plan, is still old: the stored epoch is the pre-revocation one.
	after := r.ownerGatewayRepairPlan(testOwner, settled, []string{cos, other}, map[string]string{"my-agent": "rev-1"}, time.Now())
	assert.Equal(t, 3, after.arrivedOf("my-agent"), "the regrant opened a new epoch")
	assert.Zero(t, after.generation("my-agent"), "which the pre-revocation answer cannot repair")
}

// TEST_SCENARIO: a repair waits for exactly one owner gateway pod. A rollout leaves the new pod with the previous publication already mounted, and it would take the arrival and its repair in one flip, so no receipt is taken while two pods exist and the debt is kept. The same probe against the sole pod does record the answer, which is what shows the second pod is the whole reason it did not.
func TestOwnerGatewayRepairPlan_ARepairWaitsOutTheRollout(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	s := signingSecret("platform-conn-cos", "cos", "s3.example.cloud")
	s.Namespace = "test-agents"
	_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, &s, metav1.CreateOptions{})
	require.NoError(t, err)
	granted := grantConnectionToAgent(t, r, "cos")
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	members := map[string]ownerGatewayMember{"my-agent": {agent: granted, slot: 0, secrets: []corev1.Secret{s}}}
	files, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.Contains(t, ownerGatewayCredentialKeys(files), "platform-conn-cos.aws-credentials", "the credential reached the applied Secret")

	// TEST_SCENARIO: one pod, and this plan takes the answer: that receipt is the evidence a repair needs.
	receipts := r.probeOwnerGatewayForRepair(ctx, testOwner, members, []string{"my-agent"})
	require.Equal(t, map[string]string{"my-agent": r.ownerGatewayRevisionOf("my-agent")}, receipts, "the sole pod answering its own revision is the receipt")
	held := map[string][]string{"my-agent": memberCredentialKeys(members["my-agent"], testOwner)}
	plan := r.ownerGatewayRepairPlan(testOwner, held, ownerGatewayCredentialKeys(files), receipts, time.Now())
	assert.False(t, plan.newArrival["my-agent"], "the arrival was published by the render above, so this plan takes none")
	assert.Equal(t, plan.arrivedOf("my-agent"), plan.generation("my-agent"), "and the receipt this plan took settles the debt it left")

	// TEST_SCENARIO: a second, not terminating pod is the surge, and the same probe now takes nothing at all.
	surging := ownerGatewayPod("10.42.0.10")
	surging.Name = "owner-gw-2"
	_, err = r.client.CoreV1().Pods("test-agents").Create(ctx, surging, metav1.CreateOptions{})
	require.NoError(t, err)
	assert.Empty(t, r.probeOwnerGatewayForRepair(ctx, testOwner, members, []string{"my-agent"}), "two pods, so no receipt is taken")
}

// TEST_SCENARIO: an arrival whose own write failed was never published, so the revision the pod answers belongs to the write before it and cannot be the receipt for the arrival. The debt stays until the arrival is published and answered.
func TestOwnerGatewayRepairPlan_AnUnpublishedArrivalIsNotRepaired(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	held := map[string][]string{"my-agent": {cos}}

	start := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, nil, time.Now())
	start.adopt(set, nil)
	r.ownerGatewayRevisions.Store("my-agent", "rev-1")
	r.ownerGatewayEpochs.Store("my-agent", 1)
	r.ownerGatewayAnswered.Store("my-agent", "rev-1")
	r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, map[string]string{"my-agent": "rev-1"}, time.Now()).adopt(set, nil)

	// TEST_SCENARIO: the arrival's write fails, so nothing is adopted; the stored revision and its epoch are still the ones from before the arrival.
	held["my-agent"] = []string{cos, "platform-conn-new.aws-credentials"}
	failed := r.ownerGatewayRepairPlan(testOwner, held, []string{cos, "platform-conn-new.aws-credentials"}, map[string]string{"my-agent": "rev-1"}, time.Now())
	require.Equal(t, 2, failed.arrivedOf("my-agent"), "the arrival takes a new epoch")
	retry := r.ownerGatewayRepairPlan(testOwner, held, []string{cos, "platform-conn-new.aws-credentials"}, map[string]string{"my-agent": "rev-1"}, time.Now())
	assert.Equal(t, 1, retry.generation("my-agent"), "the listener still carries the rebuild of the epoch before the arrival")
	assert.True(t, retry.agents["my-agent"].Repaired < retry.agents["my-agent"].Arrived, "and the answer to the older stored revision does not repair it")
	assert.True(t, retry.newArrival["my-agent"], "the arrival is re-detected on the retry, which is the safe direction: the failed write recorded nothing")
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
	r.config.VM = config.VMConfig{Gateway: config.VMGateway{PerOwner: true}, Runner: config.VMRunnerSpec{Rollout: config.VMRunnerRollout{MaxConcurrent: 1}}}
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
	r.config.VM = config.VMConfig{Gateway: config.VMGateway{PerOwner: true}, Runner: config.VMRunnerSpec{Rollout: config.VMRunnerRollout{MaxConcurrent: 1, MaxConcurrentPercent: 50}}}
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
	r.config.VM = config.VMConfig{Gateway: config.VMGateway{PerOwner: true}, Runner: config.VMRunnerSpec{Rollout: config.VMRunnerRollout{MaxConcurrent: 1, MaxConcurrentPercent: 50}}}
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

// TEST_SCENARIO: the rollout sweep runs in a goroutine before the agent informer starts, and its cache reads as an owner with no agents until it lists. The sweep used to render on that answer, which rewrites a serving owner's files as an empty set of listeners — the agent's Service still selects that pod. A sweep that cannot read agents yet does nothing at all.
func TestOwnerGatewaySweep_AnUnsyncedCacheIsNotAnEmptyOwner(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	before, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.Contains(t, string(before.Data[ownerGatewayLDSKey]), "agent_egress_my-agent")

	r.WithAgentCache(cache.NewGenericLister(cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc}), AgentsGVR.GroupResource()))
	r.WithAgentCacheSynced(func() bool { return false })
	r.rollOwnerGateways(ctx)

	after, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, before.Data, after.Data, "a sweep that has not read the owner's agents writes nothing")
	assert.NotEmpty(t, resourcesOf(t, string(after.Data[ownerGatewayLDSKey])), "the serving listener is still in its files")
	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "true", svc.Annotations[annOwnerGatewayServed], "and the agent's Service still selects the gateway it serves from")
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	assert.ErrorIs(t, err, errAgentCacheUnsynced, "a render on an unread cache is refused, never written")
}

// TEST_SCENARIO: the layout before one volume mounted the files in a ConfigMap at /etc/envoy and the credentials in a Secret at /etc/envoy/credentials. A pod of that layout kept serving through the upgrade reads the objects the controller keeps for it, so those objects must name the root that pod mounts: a file naming the new root fails the provider on a credential that worked before the upgrade. The whole listener, not one path, has to match.
func TestOwnerGateway_AnUpgradedOwnerKeepsServingFromTheRootsItsPodMounts(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	ownerPod := ownerGatewayPod("10.42.0.9")
	ownerPod.Spec.Volumes = []corev1.Volume{
		{Name: envoyBootstrapVolume, VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: ownerGatewayName("platform", testOwner)}}}},
		{Name: "credentials", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: ownerGatewayName("platform", testOwner) + "-credentials"}}},
	}
	_, err := r.client.CoreV1().Pods("test-agents").Update(ctx, ownerPod, metav1.UpdateOptions{})
	require.NoError(t, err)
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Spec.Template.Spec.Volumes = ownerPod.Spec.Volumes
	_, err = r.client.AppsV1().Deployments("test-agents").Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)

	s := signingSecret("platform-conn-cos", "cos", "s3.example.cloud")
	s.Namespace = "test-agents"
	_, err = r.client.CoreV1().Secrets("test-agents").Create(ctx, &s, metav1.CreateOptions{})
	require.NoError(t, err)
	live, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	granted, err := FromCacheObject[apiv1.Agent](live)
	require.NoError(t, err)
	granted.Spec.GrantedConnectionIDs = []string{"cos"}
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(granted)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, &unstructured.Unstructured{Object: raw}, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)

	legacy, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	credentials, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner)+"-credentials", metav1.GetOptions{})
	require.NoError(t, err)
	key := "platform-conn-cos.aws-credentials"
	assert.Contains(t, credentials.Data, key, "the credentials stay in the Secret that layout mounts")
	assert.NotContains(t, legacy.Data, key, "and out of the ConfigMap, which holds files only")

	lds := legacy.Data[ownerGatewayLDSKey]
	assert.Contains(t, lds, envoyCredentialsRoot+"/"+key, "the listener names the credential under the root that pod mounts")
	assert.NotContains(t, lds, ownerGatewayCredentialRoot+"/"+key, "and never the one-volume root, which that pod does not have")
	cds := legacy.Data[ownerGatewayCDSKey]
	assert.NotContains(t, cds, ownerGatewayCredentialRoot, "no upstream CA of that layout names the one-volume root either")
	assert.NotContains(t, cds, ownerGatewayCredentialRoot+"/"+key, "nor does an upstream CA of that layout read a credential the one-volume layout projects")
	resources := resourcesOf(t, lds)
	require.NotEmpty(t, resources)
	for _, res := range resources {
		raw, err := yaml.Marshal(res)
		require.NoError(t, err)
		assert.NotContains(t, string(raw), ownerGatewayCredentialRoot+"/"+key, "no listener of that layout reads the credential from the flat root it does not mount: %s", res["name"])
	}
}

// TEST_SCENARIO: an owner whose last state could not be read is not an owner with no state. Treating the failed read as a baseline makes every key the pod already has look like an arrival, which rebuilds every listener; the render waits for a successful read instead, and a Secret that is genuinely absent is the only baseline.
func TestOwnerGatewayRepairPlan_AFailedSeedIsRetriedNotGuessed(t *testing.T) {
	ctx := context.Background()
	cfg := bootstrapTestCfg
	key := "platform-conn-cos.aws-credentials"
	existing := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: ownerGatewayName(cfg.ReleaseName, testOwner), Namespace: cfg.Namespace}, Data: map[string][]byte{key: []byte("dummy")}}
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(existing)}
	client := r.client.(*fake.Clientset)
	failed := false
	client.PrependReactor("get", "secrets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if failed {
			return false, nil, nil
		}
		failed = true
		return true, nil, k8serrors.NewServiceUnavailable("one transient read failure")
	})

	r.seedOwnerGatewayOffers(ctx, testOwner)
	assert.False(t, r.ownerGatewaySeeded(testOwner), "a read that failed leaves the state unknown")

	r.seedOwnerGatewayOffers(ctx, testOwner)
	assert.True(t, r.ownerGatewaySeeded(testOwner), "the next read answers")
	assert.Empty(t, r.ownerGatewayOwesRepair(testOwner, map[string][]string{"my-agent": {key}}, []string{"my-agent"}), "and a Secret with no recorded arrival owes nothing")
}

// TEST_SCENARIO: the state the Secret carries is the live one: one small entry per member that names a credential, pruned to the members the applied render serves, so an owner that has cycled through many credentials carries nothing about the ones it retired.
func TestOwnerGatewayRepairPlan_TheNoteIsTheLiveStateNotItsHistory(t *testing.T) {
	cos, other := "platform-conn-cos.aws-credentials", "platform-conn-other.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)

	r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": {cos}}, []string{cos}, nil, time.Now()).adopt(set, nil)
	r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": {other}}, []string{other}, nil, time.Now()).adopt(set, nil)
	last := r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": {other}}, []string{other}, nil, time.Now())
	assert.NotContains(t, last.regenerated(), cos, "the retired credential is not written back")
	assert.Contains(t, last.regenerated(), "my-agent", "the member that still names one is")
}

// TEST_SCENARIO: the epoch is a fact about one agent's own credential key set, so it reaches that agent's health body and nothing else: the outer listener of a settled sibling keeps the revision it had.
func TestRenderOwnerGateway_AnEpochMovesOnlyItsOwnAgentsRevision(t *testing.T) {
	agents := ownerTestAgents()
	plain, err := renderOwnerGateway(agents, bootstrapTestCfg, nil)
	require.NoError(t, err)
	arrived, err := renderOwnerGateway(agents, bootstrapTestCfg, &ownerGatewayRepairPlan{arrived: map[string]int{"agent-a": 1}})
	require.NoError(t, err)
	assert.NotEqual(t, plain.Revisions["agent-a"], arrived.Revisions["agent-a"], "the agent whose key set moved answers a revision of this epoch")
	assert.Equal(t, plain.Revisions["agent-b"], arrived.Revisions["agent-b"], "and its sibling answers the one it always did")

	resource := func(doc, name string) string {
		for _, res := range resourcesOf(t, doc) {
			if res["name"] == name {
				raw, err := yaml.Marshal(res)
				require.NoError(t, err)
				return string(raw)
			}
		}
		t.Fatalf("no resource %s", name)
		return ""
	}
	assert.Equal(t, resource(plain.LDS, "agent_egress_agent-b"), resource(arrived.LDS, "agent_egress_agent-b"), "the settled sibling's outer listener is byte-identical")
}

// TEST_SCENARIO: the epoch belongs to the health answer only. A repair moves the internal listener's generation and the health revision stays where it was, so a repair does not re-arm the offer that decided it and the owner settles.
func TestRenderOwnerGateway_ARepairLeavesTheHealthRevisionAlone(t *testing.T) {
	agents := ownerTestAgents()
	before, err := renderOwnerGateway(agents, bootstrapTestCfg, &ownerGatewayRepairPlan{arrived: map[string]int{"agent-a": 1}, generations: map[string]int{"agent-a": 0}})
	require.NoError(t, err)
	after, err := renderOwnerGateway(agents, bootstrapTestCfg, &ownerGatewayRepairPlan{arrived: map[string]int{"agent-a": 1}, generations: map[string]int{"agent-a": 1}})
	require.NoError(t, err)
	assert.Equal(t, before.Revisions["agent-a"], after.Revisions["agent-a"], "the answer a repair is gated on survives the repair")
	assert.NotEqual(t, before.LDS, after.LDS, "and the internal listener it rebuilds does not")
}

// TEST_SCENARIO: an unchanged restart resumes the debt a settled owner left. The state is the Secret's own annotation, so the first render after a restart reads the same two numbers and writes nothing for a change that never happened.
func TestOwnerGatewayRepairPlan_AnUnchangedRestartResumesTheStateItLeft(t *testing.T) {
	ctx := context.Background()
	cfg := bootstrapTestCfg
	key := "platform-conn-cos.aws-credentials"
	raw, err := json.Marshal(ownerGatewayGenerations{Seq: 1, Agents: map[string]*ownerGatewayRepair{"my-agent": {Arrived: 1, Repaired: 1, Keys: ownerGatewayKeyDigest([]string{key})}}})
	require.NoError(t, err)
	existing := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: ownerGatewayName(cfg.ReleaseName, testOwner), Namespace: cfg.Namespace, Annotations: map[string]string{annOwnerRegenerated: string(raw)}},
		Data:       map[string][]byte{key: []byte("dummy"), ownerGatewayLDSKey: []byte("{}")},
	}
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(existing)}
	r.seedOwnerGatewayOffers(ctx, testOwner)
	held := map[string][]string{"my-agent": {key}}
	plan := r.ownerGatewayRepairPlan(testOwner, held, []string{key}, nil, time.Now())
	assert.Equal(t, 1, plan.arrivedOf("my-agent"), "the epoch it arrived at is the one the Secret records")
	assert.Equal(t, 1, plan.generation("my-agent"), "and so is the rebuild it was given")
	assert.False(t, plan.newArrival["my-agent"], "so the restart sees no arrival")
	assert.Empty(t, r.ownerGatewayOwesRepair(testOwner, held, []string{"my-agent"}), "and owes nothing")
}

// TEST_SCENARIO: an arrival that was published but not yet repaired survives a restart. The debt is two numbers on the Secret, so the restarted controller knows a repair is owed instead of reading the key as a settled baseline — which a key set alone cannot tell it.
func TestOwnerGatewayRepairPlan_ARestartKeepsAPendingRepair(t *testing.T) {
	ctx := context.Background()
	cfg := bootstrapTestCfg
	old, fresh := "platform-conn-old.aws-credentials", "platform-conn-new.aws-credentials"
	raw, err := json.Marshal(ownerGatewayGenerations{Seq: 2, Agents: map[string]*ownerGatewayRepair{"my-agent": {Arrived: 2, Repaired: 1, Keys: ownerGatewayKeyDigest([]string{old, fresh})}}})
	require.NoError(t, err)
	existing := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: ownerGatewayName(cfg.ReleaseName, testOwner), Namespace: cfg.Namespace, Annotations: map[string]string{annOwnerRegenerated: string(raw)}},
		Data:       map[string][]byte{old: []byte("dummy"), fresh: []byte("dummy"), ownerGatewayLDSKey: []byte("{}")},
	}
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(existing)}
	r.seedOwnerGatewayOffers(ctx, testOwner)
	held := map[string][]string{"my-agent": {old, fresh}}
	assert.Equal(t, []string{"my-agent"}, r.ownerGatewayOwesRepair(testOwner, held, []string{"my-agent"}), "the restarted controller still owes the repair")

	plan := r.ownerGatewayRepairPlan(testOwner, held, []string{old, fresh}, nil, time.Now())
	assert.Equal(t, 2, plan.arrivedOf("my-agent"), "at the epoch the arrival opened")
	assert.Equal(t, 1, plan.generation("my-agent"), "and the listener still carries the rebuild of the epoch before it")
	assert.False(t, plan.newArrival["my-agent"], "the key set is the one the Secret records, so this render is no new arrival")
}

// TEST_SCENARIO: an owner whose applied Secret carries no credential file is an owner with an empty baseline, not an owner that has never published. Its next key is a real arrival, so the agent granted it is rebuilt after the write that published it. Reading the empty set as "no Secret" is what made the first grant to an owner with no Connections unrecoverable.
func TestOwnerGatewayRepairPlan_TheFirstKeyOnAnEmptyOwnerIsAnArrival(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	empty := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: ownerGatewayName("platform", testOwner), Namespace: "test-agents"}}
	r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": {}}, nil, nil, time.Now()).adopt(set, empty)
	require.Empty(t, set.published, "an applied Secret with no credentials is an empty published set")
	require.NotNil(t, set.files, "and a Secret that exists")

	first := r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": {cos}}, []string{cos}, nil, time.Now())
	assert.True(t, first.newArrival["my-agent"], "so the first key it ever gets is an arrival")
	assert.Zero(t, first.generation("my-agent"), "whose own write repairs nothing")
}

// TEST_SCENARIO: revoking every key and granting one back is an arrival too. The empty set is a state the Secret really carried, so the key that returns is not a baseline, and the listener that dropped it is rebuilt for it.
func TestOwnerGatewayRepairPlan_RevokingEveryKeyThenGrantingOneIsAnArrival(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	held := map[string][]string{"my-agent": {cos}}
	r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, map[string]string{"my-agent": "rev-1"}, time.Now()).adopt(set, nil)

	empty := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: ownerGatewayName("platform", testOwner), Namespace: "test-agents"}}
	r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": {}}, nil, nil, time.Now()).adopt(set, empty)
	require.Empty(t, set.published, "every key was revoked")

	returned := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, nil, time.Now())
	assert.True(t, returned.newArrival["my-agent"], "so the return is a new arrival, not a settled baseline")
	assert.Equal(t, 2, returned.arrivedOf("my-agent"))
}

// TEST_SCENARIO: the two objects of the previous layout are removed only when nothing of that layout is left, and a delete that failed must not be reported as done: a transient API error would leave a Secret of retired signing credentials on the cluster until the controller restarted. The failure reaches the caller, and a later render tries again.
func TestOwnerGateway_ALegacyCleanupFailureIsRetried(t *testing.T) {
	ctx := context.Background()
	cfg := bootstrapTestCfg
	name := ownerGatewayName(cfg.ReleaseName, testOwner)
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(&corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name + "-credentials", Namespace: cfg.Namespace},
		Data:       map[string][]byte{"platform-conn-cos.aws-credentials": []byte("dummy")},
	})}
	client := r.client.(*fake.Clientset)
	failed := false
	client.PrependReactor("delete", "secrets", func(k8stesting.Action) (bool, runtime.Object, error) {
		if failed {
			return false, nil, nil
		}
		failed = true
		return true, nil, k8serrors.NewServiceUnavailable("one transient failure")
	})
	gone := &ownerRender{}
	require.Error(t, r.settleLegacyOwnerGatewayFiles(ctx, name, gone, nil, nil), "the failure reaches the caller")

	require.NoError(t, r.settleLegacyOwnerGatewayFiles(ctx, name, gone, nil, nil), "and the next render tries again")
	_, err := client.CoreV1().Secrets(cfg.Namespace).Get(ctx, name+"-credentials", metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "this time it is gone")
}

// TEST_SCENARIO: a legacy layout's answer keeps readiness, because that pod really is serving its layout's current configuration, but it never authorises a repair: the two layouts are separate publications, and the canonical Secret is no receipt for the other. The revision comes from the layout the controller actually applied, not from a value a test put in the map.
func TestOwnerGateway_ALegacyAnswerIsReadyButNeverARepair(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	s := signingSecret("platform-conn-cos", "cos", "s3.example.cloud")
	s.Namespace = "test-agents"
	_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, &s, metav1.CreateOptions{})
	require.NoError(t, err)
	grantConnectionToAgent(t, r, "cos")
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	ownerPod := ownerGatewayPod("10.42.0.9")
	ownerPod.Spec.Volumes = legacyOwnerGatewayVolumes()
	_, err = r.client.CoreV1().Pods("test-agents").Update(ctx, ownerPod, metav1.UpdateOptions{})
	require.NoError(t, err)
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Spec.Template.Spec.Volumes = legacyOwnerGatewayVolumes()
	_, err = r.client.AppsV1().Deployments("test-agents").Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)

	// TEST_SCENARIO: applying the old layout registers what it answers, and a pod of that layout answers exactly that: the registration is what a retained pod's readiness depends on, so it is read from the render rather than put in the map by the test.
	servingRevision := r.ownerGatewayLegacyRevisionOf("my-agent")
	require.NotEmpty(t, servingRevision, "the applied legacy layout records the revision its pods will answer")
	canonical, _ := r.ownerGatewayRevisions.Load("my-agent")
	require.NotEqual(t, canonical, servingRevision, "the two layouts answer different revisions for the same agent")
	r.ownerProbeClient = answeringGateway(servingRevision)

	ok, msg := r.ownerListenerCurrent(ctx, "my-agent", "10.42.0.9", r.config.EnvoyPort)
	assert.True(t, ok, "a pod serving its own layout's current revision is not stale: %s", msg)
	assert.Empty(t, r.ownerGatewayAnswerOf("my-agent"), "but that answer is never kept as repair evidence")
	assert.Empty(t, r.probeOwnerGatewayForRepair(ctx, testOwner, map[string]ownerGatewayMember{}, nil), "and it is no receipt either")

	// TEST_SCENARIO: once the layout is gone its revision is forgotten, so an agent it used to serve is not held ready by an answer nothing publishes.
	require.NoError(t, r.deleteLegacyOwnerGatewayFiles(ctx, ownerGatewayName("platform", testOwner)))
	require.NoError(t, r.settleLegacyOwnerGatewayFiles(ctx, ownerGatewayName("platform", testOwner), &ownerRender{}, nil, []string{"my-agent"}))
	assert.Empty(t, r.ownerGatewayLegacyRevisionOf("my-agent"), "the retired layout's revision does not outlive it")
}

// TEST_SCENARIO: the two objects the layout before one volume mounts, which is what makes a pod of that layout distinguishable from a current one.
func legacyOwnerGatewayVolumes() []corev1.Volume {
	name := ownerGatewayName("platform", testOwner)
	return []corev1.Volume{
		{Name: envoyBootstrapVolume, VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: name}}}},
		{Name: "credentials", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: name + "-credentials"}}},
	}
}

// TEST_SCENARIO: an owner gateway that answers one fixed revision on every listener, which is how a test poses as a pod of one layout.
func answeringGateway(answer string) *http.Client {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(answer))
	}))
	return &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}}}
}

// TEST_SCENARIO: the repair state lives in an annotation, so a write that changes only that annotation must still reach the cluster: skipping it would adopt in memory a state the Secret never carried, and a restart would read the older one.
func TestOwnerGateway_AnAnnotationOnlyChangeIsWritten(t *testing.T) {
	ctx := context.Background()
	cfg := bootstrapTestCfg
	name := ownerGatewayName(cfg.ReleaseName, testOwner)
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(&corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: cfg.Namespace, Annotations: map[string]string{annOwnerRegenerated: "old"}},
		Data:       map[string][]byte{ownerGatewayLDSKey: []byte("{}")},
	})}
	desired := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: cfg.Namespace, Annotations: map[string]string{annOwnerRegenerated: "new"}},
		Data:       map[string][]byte{ownerGatewayLDSKey: []byte("{}")},
	}
	require.NoError(t, r.applyOwnerGatewayFiles(ctx, desired))
	stored, err := r.client.CoreV1().Secrets(cfg.Namespace).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, "new", stored.Annotations[annOwnerRegenerated], "the annotation-only change reached the cluster")
}

// TEST_SCENARIO: the receipt is only evidence about the arrival when the revision it answers is the one rendered at that arrival. The revision encodes the arrival epoch, and the epoch the controller recorded beside it is what says so; when the two disagree — the revision in memory is not the one this arrival was rendered at — the debt stays rather than being spent on an answer about an older rendering.
func TestOwnerGatewayRepairPlan_AReceiptMustBeForTheArrivalsOwnEpoch(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	held := map[string][]string{"my-agent": {cos}}

	start := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, nil, time.Now())
	start.adopt(set, nil)
	// TEST_SCENARIO: the revision the pod answered was rendered at epoch 0, before this arrival; the agent's own key set then moved to epoch 1 and that write was applied, so no new arrival is detected. Only the epoch recorded beside the revision stands between this answer and the debt.
	r.ownerGatewayRevisions.Store("my-agent", "rev-old-epoch")
	r.ownerGatewayEpochs.Store("my-agent", 0)
	r.ownerGatewayAnswered.Store("my-agent", "rev-old-epoch")
	set.mu.Lock()
	set.agents["my-agent"].Arrived = 1
	set.mu.Unlock()

	plan := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, map[string]string{"my-agent": "rev-old-epoch"}, time.Now())
	require.False(t, plan.newArrival["my-agent"], "the key set has not moved, so this is no arrival")
	require.Equal(t, "rev-old-epoch", r.ownerGatewayRevisionOf("my-agent"), "and the pod did answer the revision in memory")
	assert.Zero(t, plan.generation("my-agent"), "but that revision was not rendered at this arrival, so the debt stays")
	assert.True(t, plan.agents["my-agent"].Repaired < plan.agents["my-agent"].Arrived)
}

// TEST_SCENARIO: grants a Connection to the test agent through the dynamic client, so the reconciler reads it as it would any other grant.
func grantConnectionToAgent(t *testing.T, r *AgentReconciler, connection string) *apiv1.Agent {
	t.Helper()
	return grantConnectionTo(t, r, "my-agent", connection)
}

// TEST_SCENARIO: the same grant, to whichever agent the test names.
func grantConnectionTo(t *testing.T, r *AgentReconciler, agent, connection string) *apiv1.Agent {
	t.Helper()
	live, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), agent, metav1.GetOptions{})
	require.NoError(t, err)
	granted, err := FromCacheObject[apiv1.Agent](live)
	require.NoError(t, err)
	granted.Spec.GrantedConnectionIDs = append(granted.Spec.GrantedConnectionIDs, connection)
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(granted)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(context.Background(), &unstructured.Unstructured{Object: raw}, metav1.UpdateOptions{})
	require.NoError(t, err)
	return granted
}

// TEST_SCENARIO: an agent whose key set leaves the render keeps no state in it. A partial refusal applies one agent's files and discards another's; the plan is built from the retained membership, so the discarded agent takes no arrival epoch and writes no repair entry into the Secret, which is work that was never rendered there.
func TestOwnerGateway_APartialRefusalForgetsTheDiscardedMember(t *testing.T) {
	r, _, _ := servedVMReconciler(t)
	held := map[string][]string{
		"my-agent": {"platform-conn-cos.aws-credentials"},
		"agent-b":  {"platform-conn-two.aws-credentials"},
	}
	set := r.ownerGatewayOffersFor(testOwner)
	all := r.ownerGatewayRepairPlan(testOwner, held, []string{"platform-conn-cos.aws-credentials", "platform-conn-two.aws-credentials"}, nil, time.Now())
	all.adopt(set, nil)
	require.Contains(t, all.agents, "agent-b")

	// TEST_SCENARIO: the next render serves only one of them, so the other's files are discarded and its state goes with them.
	served := memberKeys(held, []string{"my-agent"})
	refused := r.ownerGatewayRepairPlan(testOwner, served, []string{"platform-conn-cos.aws-credentials"}, nil, time.Now())
	assert.NotContains(t, refused.agents, "agent-b", "an agent whose files were discarded holds no state in the render that discarded them")
	assert.Empty(t, refused.arrivedOf("agent-b"))
	assert.False(t, refused.newArrival["agent-b"])
}

// TEST_SCENARIO: a key set that moves and comes back is only a change if the agent's own set is what is compared. Two agents share one owner Secret; the owner-wide union of keys is unchanged when a key moves between them, so an implementation that hashed that union would rebuild neither, and both listeners would stay built on the pathname that moved.
func TestOwnerGatewayRepairPlan_AKeyMovingBetweenAgentsIsAnArrivalForBoth(t *testing.T) {
	shared, other := "platform-conn-shared.aws-credentials", "platform-conn-other.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	union := []string{shared, other}
	before := map[string][]string{"my-agent": {shared}, "agent-b": {other}}
	r.ownerGatewayRepairPlan(testOwner, before, union, nil, time.Now()).adopt(set, nil)

	// TEST_SCENARIO: the same two keys are published, so the owner's own key union does not move, and each agent's set does.
	after := map[string][]string{"my-agent": {other}, "agent-b": {shared}}
	moved := r.ownerGatewayRepairPlan(testOwner, after, union, nil, time.Now())
	assert.True(t, moved.newArrival["my-agent"], "the agent lost one key and gained another")
	assert.True(t, moved.newArrival["agent-b"], "and so did its sibling, even though the Secret's key set is the same")
	assert.NotEqual(t, moved.arrivedOf("my-agent"), moved.arrivedOf("agent-b"), "each arrival takes its own epoch")
}

// TEST_SCENARIO: an owner gateway deep enough in the past that its surplus pods are gone keeps its debt and asks each owing agent once, on that agent's own port. A settled sibling is not probed: a render must not wait on an agent that owes nothing.
func TestOwnerGateway_OnlyOwingAgentsAreProbed(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	settled := "platform-conn-cos.aws-credentials"
	owing := "platform-conn-two.aws-credentials"
	set := r.ownerGatewayOffersFor(testOwner)
	held := map[string][]string{"my-agent": {settled}, "agent-b": {owing}}
	start := r.ownerGatewayRepairPlan(testOwner, held, []string{settled, owing}, nil, time.Now())
	start.adopt(set, nil)
	// TEST_SCENARIO: each agent is at a different epoch, and only agent-b's is unpaid.
	set.mu.Lock()
	set.agents["my-agent"] = &ownerGatewayRepair{Arrived: 1, Repaired: 1, Keys: ownerGatewayKeyDigest([]string{settled})}
	set.agents["agent-b"] = &ownerGatewayRepair{Arrived: 2, Repaired: 1, Keys: ownerGatewayKeyDigest([]string{owing})}
	set.mu.Unlock()
	require.Equal(t, []string{"agent-b"}, r.ownerGatewayOwesRepair(testOwner, held, []string{"my-agent", "agent-b"}))

	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		asked = append(asked, req.Host)
		_, _ = w.Write([]byte(""))
	}))
	t.Cleanup(srv.Close)
	r.ownerProbeClient = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}}}
	two := signingSecret("platform-conn-two", "two", "s3.example.cloud")
	two.Namespace, two.Labels = "test-agents", map[string]string{envoyOwnerLabel: testOwner}
	members := map[string]ownerGatewayMember{"my-agent": {slot: 0}, "agent-b": {slot: 1, secrets: []corev1.Secret{two}}}
	require.NotEmpty(t, memberCredentialKeys(members["agent-b"], testOwner))
	r.ownerGatewayRevisions.Store("agent-b", "rev-b")
	r.probeOwnerGatewayForRepair(ctx, testOwner, members, r.ownerGatewayOwesRepair(testOwner, held, []string{"my-agent", "agent-b"}))
	assert.Equal(t, []string{"10.42.0.9:" + strconv.Itoa(ownerGatewayProxyPort(1))}, asked, "only the owing agent is asked, on its own port")
}

// TEST_SCENARIO: a member whose grant is gone takes its state with it, so the annotation stays bounded by the members the owner actually serves. The departed entry is the one thing an absent member must not leave behind.
func TestOwnerGateway_AStatePrunesTheMembersItNoLongerServes(t *testing.T) {
	r, _, _ := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	cos := "platform-conn-cos.aws-credentials"
	both := map[string][]string{"my-agent": {cos}, "agent-b": {cos}}
	r.ownerGatewayRepairPlan(testOwner, both, []string{cos}, nil, time.Now()).adopt(set, nil)

	gone := r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": {cos}}, []string{cos}, nil, time.Now())
	assert.NotContains(t, gone.agents, "agent-b", "a member the owner no longer serves is not carried forward")
	var state ownerGatewayGenerations
	require.NoError(t, json.Unmarshal([]byte(gone.regenerated()), &state))
	assert.NotContains(t, state.Agents, "agent-b")
}

// TEST_SCENARIO: the whole render asks for a receipt before it decides, so a debt is looked at while the pod that owes it is still the only one. The plan is built with whatever that probe returned, which is nothing when the probe could not be made, so no debt is settled on evidence this render did not gather.
func TestOwnerGateway_ARenderTakesItsReceiptFromTheProbe(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	s := signingSecret("platform-conn-cos", "cos", "s3.example.cloud")
	s.Namespace = "test-agents"
	_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, &s, metav1.CreateOptions{})
	require.NoError(t, err)
	grantConnectionToAgent(t, r, "cos")
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	// TEST_SCENARIO: the agent owes a repair, and the pod answers its revision, so the render settles it in the write it makes.
	set := r.ownerGatewayOffersFor(testOwner)
	set.mu.Lock()
	set.agents["my-agent"].Repaired = 0
	set.mu.Unlock()
	require.Equal(t, []string{"my-agent"}, r.ownerGatewayOwesRepair(testOwner, map[string][]string{"my-agent": {"platform-conn-cos.aws-credentials"}}, []string{"my-agent"}))

	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	assert.Empty(t, r.ownerGatewayOwesRepair(testOwner, map[string][]string{"my-agent": {"platform-conn-cos.aws-credentials"}}, []string{"my-agent"}), "the render took the receipt and spent the debt")

	// TEST_SCENARIO: a pod that does not answer leaves the same debt owed, since no receipt was taken.
	set.mu.Lock()
	set.agents["my-agent"].Repaired = 0
	set.mu.Unlock()
	r.ownerProbeClient = &http.Client{Transport: &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { return nil, errors.New("refused") }}}
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	assert.Equal(t, []string{"my-agent"}, r.ownerGatewayOwesRepair(testOwner, map[string][]string{"my-agent": {"platform-conn-cos.aws-credentials"}}, []string{"my-agent"}), "an unanswered debt stays owed")
}

// TEST_SCENARIO: an owner whose Secret carries no repair state yet is a baseline, not a set of arrivals. That is every owner on the upgrade from the single-volume layout, and its pods roll onto fresh mounts anyway, so rebuilding every listener would drain streams for a change that has not happened. The next render records the baseline, and only a key set that moves after that is an arrival.
func TestOwnerGateway_AFreshOwnerStartsFromItsBaseline(t *testing.T) {
	ctx := context.Background()
	cfg := bootstrapTestCfg
	key, second := "platform-conn-cos.aws-credentials", "platform-conn-two.aws-credentials"
	existing := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: ownerGatewayName(cfg.ReleaseName, testOwner), Namespace: cfg.Namespace},
		Data:       map[string][]byte{key: []byte("dummy"), ownerGatewayLDSKey: []byte("{}")},
	}
	r := &AgentReconciler{config: cfg, client: fake.NewSimpleClientset(existing)}
	r.seedOwnerGatewayOffers(ctx, testOwner)
	held := map[string][]string{"my-agent": {key}}

	// TEST_SCENARIO: a Secret with a key and no state is an upgrade, so its agent takes no arrival.
	baseline := r.ownerGatewayRepairPlan(testOwner, held, []string{key}, nil, time.Now())
	assert.False(t, baseline.newArrival["my-agent"], "an owner with no recorded state is a baseline, so its existing key is no arrival")
	assert.Zero(t, baseline.arrivedOf("my-agent"), "and its epoch stays zero")
	assert.Zero(t, baseline.generation("my-agent"), "so nothing is rebuilt for it")
	assert.Empty(t, r.ownerGatewayOwesRepair(testOwner, held, []string{"my-agent"}))
	baseline.adopt(r.ownerGatewayOffersFor(testOwner), existing)

	// TEST_SCENARIO: once that baseline is written, a key set that moves is an arrival again.
	held["my-agent"] = []string{key, second}
	moved := r.ownerGatewayRepairPlan(testOwner, held, []string{key, second}, nil, time.Now())
	assert.True(t, moved.newArrival["my-agent"], "a key set that moves after the baseline is an arrival")
	assert.Equal(t, 1, moved.arrivedOf("my-agent"))
}

// TEST_SCENARIO: the repair state goes into an annotation beside a Secret that is already near its own budget, and Kubernetes bounds every annotation of an object at 256 KiB independently of the data. Storing each member's credential file names would grow with the grant and pass the data check while the object becomes unwritable; a fixed digest does not.
func TestOwnerGateway_TheRepairStateStaysASmallAnnotation(t *testing.T) {
	cos := "platform-conn-cos.aws-credentials"
	r, _, _ := servedVMReconciler(t)
	held := map[string][]string{"my-agent": {cos}}
	plan := r.ownerGatewayRepairPlan(testOwner, held, []string{cos}, nil, time.Now())

	var many []string
	for i := range 3000 {
		many = append(many, fmt.Sprintf("platform-conn-%04d.aws-credentials", i))
	}
	wide := r.ownerGatewayRepairPlan(testOwner, map[string][]string{"my-agent": many}, many, nil, time.Now())

	assert.Less(t, len(wide.regenerated()), 2048, "3000 credential files must not put their names in the annotation")
	assert.Less(t, len(wide.regenerated()), len(fmt.Sprintf("%q", many))/100, "the state does not scale with the names it describes")
	assert.NotEmpty(t, plan.regenerated())
}

// TEST_SCENARIO: a gateway that answers its current revision is not therefore ready when it still owes a repair: the answer proves the pod read the files, not that it rebuilt the provider it could not build. Reporting ready would hide the one state where traffic is unsigned on a gateway that looks healthy.
func TestOwnerGateway_PendingRepairIsNotReady(t *testing.T) {
	ctx := context.Background()
	r, _, agent := servedVMReconciler(t)
	set := r.ownerGatewayOffersFor(testOwner)
	s := signingSecret("platform-conn-cos", "cos", "s3.example.cloud")
	s.Namespace = "test-agents"
	_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, &s, metav1.CreateOptions{})
	require.NoError(t, err)
	grantConnectionToAgent(t, r, "cos")
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, GatewayName("my-agent"), metav1.GetOptions{})
	require.NoError(t, err)
	require.Equal(t, "true", svc.Annotations[annOwnerGatewayServed], "the agent is served by its owner gateway")
	// TEST_SCENARIO: the arrival that grant made is repaid, and the gateway is ready for the agent.
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	ready, reason, msg := r.gatewayReadiness(ctx, agent)
	require.True(t, ready, "a settled gateway is ready: %s %s", reason, msg)

	// TEST_SCENARIO: the same current listener, with an unpaid arrival on it.
	set.mu.Lock()
	set.agents["my-agent"].Arrived = set.agents["my-agent"].Repaired + 1
	set.mu.Unlock()
	ready, reason, msg = r.gatewayReadiness(ctx, agent)
	assert.False(t, ready, "a gateway still owing a repair for this agent is not ready for it")
	assert.Equal(t, apiv1.ReasonOwnerGatewayListenerStale, reason)
	assert.Contains(t, msg, "credentials")
}

// TEST_SCENARIO: a second vm agent of the same owner, with the Service its gateway serves from, so an owner render has two members to keep or discard.
func ownerSecondAgent(t *testing.T, r *AgentReconciler, name, clusterIP string, served bool) {
	t.Helper()
	ctx := context.Background()
	second := vmAgentCR()
	second.Name, second.Labels = name, map[string]string{envoyOwnerLabel: testOwner}
	u, err := agentToUnstructured(second)
	require.NoError(t, err)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Create(ctx, u, metav1.CreateOptions{})
	require.NoError(t, err)
	annotations := map[string]string{annOwnerGatewaySlot: "1"}
	if served {
		annotations[annOwnerGatewayServed] = "true"
	}
	_, err = r.client.CoreV1().Services("test-agents").Create(ctx, &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName(name), Namespace: "test-agents", Labels: map[string]string{LabelRole: RoleGateway, LabelAgent: name}, Annotations: annotations},
		Spec:       corev1.ServiceSpec{ClusterIP: clusterIP, Ports: []corev1.ServicePort{{Port: 10000}}},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: two signing Connections of one owner, each naming its own host, so both agents project a credential file of their own.
func ownerTwoSigningSecrets(t *testing.T, r *AgentReconciler) {
	t.Helper()
	ctx := context.Background()
	for name, host := range map[string]string{"platform-conn-cos": "s3.example.cloud", "platform-conn-two": "two.example.cloud"} {
		s := signingSecret(name, strings.TrimPrefix(name, "platform-conn-"), host)
		s.Namespace = "test-agents"
		_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, &s, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	grantConnectionToAgent(t, r, "cos")
	grantConnectionTo(t, r, "agent-b", "two")
}

// TEST_SCENARIO: the retained-membership filter is a rule of the render itself, not of the planner it feeds. Two agents of one owner both name credentials; when the owner is refused one of them, the applied Secret carries neither that agent's file nor any state for it. The check drives production `ensureOwnerGateway` at two budgets, not the planner directly.
func TestOwnerGateway_ARefusedMemberLeavesNoStateInTheRender(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	// TEST_SCENARIO: agent-b has not moved onto the owner gateway yet, which is what lets a refusal discard it and keep the served agent.
	ownerSecondAgent(t, r, "agent-b", "10.96.42.43", false)
	ownerTwoSigningSecrets(t, r)

	// TEST_SCENARIO: both fit, so both are rendered and both hold state.
	r.ownerGatewayBudget = 0
	_, err := r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	files, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.Contains(t, files.Data, "platform-conn-two.aws-credentials", "both agents are rendered to begin with")
	var before ownerGatewayGenerations
	require.NoError(t, json.Unmarshal([]byte(files.Annotations[annOwnerRegenerated]), &before))
	require.Contains(t, before.Agents, "agent-b")

	// TEST_SCENARIO: then only one fits, so the production render discards the other's files.
	r.ownerGatewayBudget = secretSize(files) - 512
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	files, err = r.client.CoreV1().Secrets("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.NotContains(t, files.Data, "platform-conn-two.aws-credentials", "the refused agent's credential is not written")
	require.Contains(t, files.Data, "platform-conn-cos.aws-credentials", "the served agent's is")
	var after ownerGatewayGenerations
	require.NoError(t, json.Unmarshal([]byte(files.Annotations[annOwnerRegenerated]), &after))
	assert.NotContains(t, after.Agents, "agent-b", "a member whose files the render discarded holds no state in it")
	assert.Contains(t, after.Agents, "my-agent")
}

// TEST_SCENARIO: the render probes the members that owe a repair and no others, which is a rule of `ensureOwnerGateway` and not of the helper it calls. One agent has settled and its sibling owes, and the render must ask only the owing agent's port.
func TestOwnerGateway_ARenderProbesOnlyTheOwingAgent(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	ownerSecondAgent(t, r, "agent-b", "10.96.42.43", true)
	ownerTwoSigningSecrets(t, r)
	_, err := r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)

	// TEST_SCENARIO: my-agent's arrival is repaid, and agent-b's is not.
	set := r.ownerGatewayOffersFor(testOwner)
	set.mu.Lock()
	set.agents["my-agent"].Repaired = set.agents["my-agent"].Arrived
	set.agents["agent-b"].Repaired = set.agents["agent-b"].Arrived - 1
	set.mu.Unlock()
	held := map[string][]string{
		"my-agent": {"platform-conn-cos.aws-credentials"},
		"agent-b":  {"platform-conn-two.aws-credentials"},
	}
	require.Equal(t, []string{"agent-b"}, r.ownerGatewayOwesRepair(testOwner, held, []string{"my-agent", "agent-b"}))

	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		asked = append(asked, req.Host)
		_, _ = w.Write([]byte(""))
	}))
	t.Cleanup(srv.Close)
	r.ownerProbeClient = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}}}
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	assert.Equal(t, []string{"10.42.0.9:" + strconv.Itoa(ownerGatewayProxyPort(1))}, asked, "the render asks the owing agent's port and not its settled sibling's")
}

// TEST_SCENARIO: retiring one owner's legacy layout leaves every other owner's registrations alone. Two owners keep old-layout pods at once, and an ordinary render of a third owner that has no legacy layout must not make either of them unready.
func TestOwnerGateway_ALegacyRetirementIsScopedToItsOwner(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	r.ownerGatewayLegacyRevisions.Store("my-agent", "legacy-of-this-owner")
	r.ownerGatewayLegacyRevisions.Store("other-owner-agent", "legacy-of-another-owner")

	// TEST_SCENARIO: this owner still runs its old layout, and settling it registers its own members and touches no one else's.
	require.NoError(t, r.settleLegacyOwnerGatewayFiles(ctx, ownerGatewayName("platform", testOwner), &ownerRender{files: &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "x", Namespace: "test-agents"}}, revisions: map[string]string{"my-agent": "legacy-new"}}, nil, []string{"my-agent"}))
	assert.Equal(t, "legacy-new", r.ownerGatewayLegacyRevisionOf("my-agent"))
	assert.Equal(t, "legacy-of-another-owner", r.ownerGatewayLegacyRevisionOf("other-owner-agent"), "another owner's registration survives this owner's render")

	// TEST_SCENARIO: this owner retires its layout, so only its own registration goes.
	require.NoError(t, r.deleteLegacyOwnerGatewayFiles(ctx, ownerGatewayName("platform", testOwner)))
	require.NoError(t, r.settleLegacyOwnerGatewayFiles(ctx, ownerGatewayName("platform", testOwner), &ownerRender{}, nil, []string{"my-agent"}))
	assert.Empty(t, r.ownerGatewayLegacyRevisionOf("my-agent"), "its own retired registration is gone")
	assert.Equal(t, "legacy-of-another-owner", r.ownerGatewayLegacyRevisionOf("other-owner-agent"), "and every other owner's is untouched")
}

// TEST_SCENARIO: the same scoping when one owner holds its layout and another has already retired: the retiring owner's cleanup must not clear the holder's registration, which is the case a render of an owner with no legacy objects at all hits.
func TestOwnerGateway_ACanonicalOwnerDoesNotClearALegacyOne(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	r.ownerGatewayLegacyRevisions.Store("other-owner-agent", "legacy-of-another-owner")
	require.NoError(t, r.settleLegacyOwnerGatewayFiles(ctx, ownerGatewayName("platform", testOwner), &ownerRender{}, nil, []string{"my-agent"}))
	assert.Equal(t, "legacy-of-another-owner", r.ownerGatewayLegacyRevisionOf("other-owner-agent"), "a canonical owner's render leaves the legacy owner's registration intact")
}

// TEST_SCENARIO: the normal move-back: the agent's own gateway is rendered and ready, and its Service selects that gateway again.
func moveAgentBackToOwnGateway(t *testing.T, r *AgentReconciler, name string) {
	t.Helper()
	ctx := context.Background()
	live, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	agent, err := FromCacheObject[apiv1.Agent](live)
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, agent), "its own gateway is rendered")
	markGatewayPodReady(t, r, name)
	require.NoError(t, r.Reconcile(ctx, agent), "and its Service moves back once that gateway is ready")
	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, GatewayName(name), metav1.GetOptions{})
	require.NoError(t, err)
	require.Empty(t, svc.Annotations[annOwnerGatewayServed], "the agent is back on its own gateway")
}

// TEST_SCENARIO: a member that moved back to its own gateway is no longer served by the owner's legacy layout, so the registration it left behind must go with it. Otherwise that retired answer is still accepted for the member, and on rejoin it would carry the member onto the owner gateway although nothing this owner published any more contains its listener.
func TestOwnerGateway_ADepartureRetiresItsLegacyRevision(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	ownerSecondAgent(t, r, "agent-b", "10.96.42.43", true)
	ownerTwoSigningSecrets(t, r)

	// TEST_SCENARIO: both members are on the old layout, which registers a revision for each.
	ownerPod := ownerGatewayPod("10.42.0.9")
	ownerPod.Spec.Volumes = legacyOwnerGatewayVolumes()
	_, err := r.client.CoreV1().Pods("test-agents").Update(ctx, ownerPod, metav1.UpdateOptions{})
	require.NoError(t, err)
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Spec.Template.Spec.Volumes = legacyOwnerGatewayVolumes()
	_, err = r.client.AppsV1().Deployments("test-agents").Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	require.NotEmpty(t, r.ownerGatewayLegacyRevisionOf("agent-b"), "the layout it is served by registers its revision")

	// TEST_SCENARIO: agent-b's own gateway becomes ready with the flag off, so the normal move-back clears its served mark and the next render stops serving it from the legacy layout.
	r.config.VM.Gateway.PerOwner = false
	moveAgentBackToOwnGateway(t, r, "agent-b")
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)

	legacy, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	require.NotContains(t, legacy.Data[ownerGatewayLDSKey], "agent-b", "the applied legacy layout no longer carries it")
	assert.Empty(t, r.ownerGatewayLegacyRevisionOf("agent-b"), "so the revision it used to answer with is retired")
	assert.NotEmpty(t, r.ownerGatewayLegacyRevisionOf("my-agent"), "and the member still served keeps its own")
}

// TEST_SCENARIO: the same departure, followed by a rejoin while the old pod still answers the retired revision. Nothing this owner publishes contains that member's listener, so its stale answer must not authorise the cutover: it keeps its own gateway until the owner really serves it again.
func TestOwnerGateway_ARejoinDoesNotCutOverOnARetiredLegacyAnswer(t *testing.T) {
	ctx := context.Background()
	r, _, _ := servedVMReconciler(t)
	ownerSecondAgent(t, r, "agent-b", "10.96.42.43", true)
	ownerTwoSigningSecrets(t, r)
	ownerPod := ownerGatewayPod("10.42.0.9")
	ownerPod.Spec.Volumes = legacyOwnerGatewayVolumes()
	_, err := r.client.CoreV1().Pods("test-agents").Update(ctx, ownerPod, metav1.UpdateOptions{})
	require.NoError(t, err)
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	dep.Spec.Template.Spec.Volumes = legacyOwnerGatewayVolumes()
	_, err = r.client.AppsV1().Deployments("test-agents").Update(ctx, dep, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	retired := r.ownerGatewayLegacyRevisionOf("agent-b")
	require.NotEmpty(t, retired)

	// TEST_SCENARIO: agent-b moves back, and the render that follows stops serving it.
	r.config.VM.Gateway.PerOwner = false
	moveAgentBackToOwnGateway(t, r, "agent-b")
	_, err = r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)

	// TEST_SCENARIO: it is eligible to rejoin, its canonical rendering has moved, and the old pod still answers the retired revision.
	r.config.VM.Gateway.PerOwner = true
	r.ownerProbeClient = answeringGateway(retired)
	members, err := r.ensureOwnerGateway(ctx, testOwner)
	require.NoError(t, err)
	m, ok := members["agent-b"]
	require.True(t, ok, "the render still knows the member")
	require.False(t, m.served, "it is not served yet")
	r.cutOverToOwnerGateway(ctx, testOwner, map[string]ownerGatewayMember{"agent-b": m})

	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, GatewayName("agent-b"), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, svc.Annotations[annOwnerGatewayServed], "a retired answer does not carry the member onto the owner gateway")
}
