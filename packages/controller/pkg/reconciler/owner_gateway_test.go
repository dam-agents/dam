package reconciler

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
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
	probe := dep.Spec.Template.Spec.Containers[0].ReadinessProbe
	require.NotNil(t, probe, "the surge holds only if the new pod turns ready once Envoy has loaded the agents' files")
	assert.Equal(t, r.config.EnvoyPort, probe.HTTPGet.Port.IntValue())

	cm, err := r.client.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, cm.Data[ownerGatewayLDSKey], "agent_egress_my-agent")
	assert.Contains(t, cm.Data[machineDNSCorefileKey], ".:20001 {")
	assert.Contains(t, cm.Data[ownerGatewayBootstrap], "owner_gateway_health")
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

// TEST_SCENARIO: the owner gateway mounts one credential Secret for all of the owner's agents, and the kubelet refreshes that mount only when it syncs the pod, as it does an agent's own gateway's. So its pod carries the Secret's content hash, and a new hash syncs it at once and asks one of its agents to come back for the second sync, which a kubelet whose copy of the Secret was still old needs. A pod that is going away is left alone.
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

	creds, err := r.client.CoreV1().Secrets(ns).Get(ctx, ownerGatewayName("platform", testOwner)+"-credentials", metav1.GetOptions{})
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

// TEST_SCENARIO: Envoy keeps the listener it accepted, credentials provider and all, so a pod that took the files before the Secret their chains name was mounted answers the current revision and stays unsigned, and nothing the controller can read says so. The repair is therefore a rendering re-applied on its own: files whose version moves, which is what a refused listener needs, and a generation on the listener of an agent with a signing chain, which is the only thing that makes Envoy recreate a listener it already accepted.
func TestRenderOwnerGateway_ARepairRecreatesOnlyTheSignedListeners(t *testing.T) {
	cfg := telemetryTestCfg()
	agents := []ownerGatewayAgent{
		{Name: "agent-signed", ProxyPort: 20000, Chains: chainsFromSecrets([]corev1.Secret{signingSecret("platform-conn-cos", "conn-cos", "s3.example.cloud")}, nil)},
		{Name: "agent-injected", ProxyPort: 20002, Chains: ownerTestAgents()[0].Chains},
	}
	plain, err := renderOwnerGateway(agents, cfg, nil)
	require.NoError(t, err)

	names := []string{"agent-signed", "agent-injected"}
	now := time.Now()
	r := &AgentReconciler{}
	plan := r.ownerGatewayRepairPlan(testOwner, names, now)
	require.Equal(t, "", plan.xdsVersion(), "a rendering with nothing owed carries the template's version")
	for _, a := range agents {
		require.Equal(t, 0, plan.generation(a.Name, plain.Revisions[a.Name], len(a.Chains[0].Signers) > 0))
	}
	repaired, err := renderOwnerGateway(agents, cfg, r.ownerGatewayRepairPlan(testOwner, names, now.Add(ownerGatewayReapplySchedule[0])))
	require.NoError(t, err)

	assert.Equal(t, ownerGatewayTemplateRev+"-repair-1", ownerGatewayLDSVersion(t, repaired.LDS), "the files move, so the pod reads them again")
	assert.Equal(t, plain.Revisions["agent-signed"], repaired.Revisions["agent-signed"], "the revision a health path answers is what was rendered, not how often it was sent")

	// TEST_SCENARIO: only an agent with a signing provider to rebuild pays for the repair with a listener Envoy recreates; every other listener and every cluster is untouched, so no sibling's streams are drained for it.
	assert.Equal(t, "1", ownerGatewayListenerField(t, repaired.LDS, "tls_inspect_internal_agent-signed", "metadata", "filter_metadata", "platform", "repair_generation"))
	assert.Nil(t, resourcesNamed(t, repaired.LDS, "tls_inspect_internal_agent-injected")["metadata"], "an agent with no signing provider keeps the listener Envoy already has")
	assert.Equal(t, resourcesNamed(t, plain.LDS, "tls_inspect_internal_agent-injected"), resourcesNamed(t, repaired.LDS, "tls_inspect_internal_agent-injected"))
	assert.Equal(t, resourcesNamed(t, plain.LDS, "agent_egress_agent-signed"), resourcesNamed(t, repaired.LDS, "agent_egress_agent-signed"))
	assert.Equal(t, resourcesOf(t, plain.CDS), resourcesOf(t, repaired.CDS))
}

// TEST_SCENARIO: the failure of the vm lane, end to end in what the controller and the pod each do. A new signing chain is rendered while the Secret its credential file lives in is not mounted yet: Envoy builds the provider, its first read fails, it accepts the listener anyway and answers the current revision, so nothing the controller reads says the agent is unsigned. Projecting the file later does not help, because the provider never watched it, and neither does re-sending the same listener, because Envoy keeps the one it accepted. Only a listener whose content moved is recreated, and that is what the repair renders.
func TestOwnerGateway_AListenerAcceptedBeforeItsCredentialFileIsRecreated(t *testing.T) {
	cfg := telemetryTestCfg()
	agents := []ownerGatewayAgent{{Name: "agent-signed", ProxyPort: 20000, Chains: chainsFromSecrets([]corev1.Secret{signingSecret("platform-conn-cos", "conn-cos", "s3.example.cloud")}, nil)}}
	names := []string{"agent-signed"}
	internal := "tls_inspect_internal_agent-signed"
	r := &AgentReconciler{}
	now := time.Now()

	first, err := renderOwnerGateway(agents, cfg, r.ownerGatewayRepairPlan(testOwner, names, now))
	require.NoError(t, err)
	file := signingFile(t, resourcesNamed(t, first.LDS, internal))
	require.NotEmpty(t, file)
	pod := newFakeOwnerEnvoy(append(bootstrapClusterNames(t, first.Bootstrap), clusterNames(t, first.CDS)...)...)
	pod.files = map[string]string{}
	pod.project(t, first.LDS)
	assert.Empty(t, pod.accessKey(internal), "the provider read its file before it was there and does not try again")

	// TEST_SCENARIO: the credential file is projected, and the pod reads the files it has. A plain render of the same files is byte-identical, so the pod is sent nothing it has not already accepted and the agent stays unsigned.
	pod.files = map[string]string{file: "AKIAPROJECTED"}
	plain, err := renderOwnerGateway(agents, cfg, nil)
	require.NoError(t, err)
	pod.project(t, plain.LDS)
	assert.Empty(t, pod.accessKey(internal), "a listener Envoy accepted is not rebuilt by the files being read again")

	// TEST_SCENARIO: the repair's re-application renders the listener again, with its generation moved, so Envoy recreates it now that the file is mounted, and the requests it carries are signed.
	repaired, err := renderOwnerGateway(agents, cfg, r.ownerGatewayRepairPlan(testOwner, names, now.Add(ownerGatewayReapplySchedule[0])))
	require.NoError(t, err)
	pod.project(t, repaired.LDS)
	assert.Equal(t, "AKIAPROJECTED", pod.accessKey(internal), "the listener was recreated and its provider read the file")
}

// TEST_SCENARIO: LDS is applied one resource at a time, so a pod can accept an agent's outer listener, whose clusters it already has, and refuse its internal one, whose upstream cluster is still in a CDS file it has not read. The outer listener answers the current health body, so nothing the controller reads says the agent's signing chains never loaded. The files moving is what makes the pod read them again, and the refused listener is offered once more and accepted.
func TestOwnerGateway_ARejectedInternalListenerIsOfferedAgainWhenTheFilesMove(t *testing.T) {
	cfg := telemetryTestCfg()
	agents := []ownerGatewayAgent{{Name: "agent-signed", ProxyPort: 20000, Chains: chainsFromSecrets([]corev1.Secret{signingSecret("platform-conn-cos", "conn-cos", "s3.example.cloud")}, nil)}}
	names := []string{"agent-signed"}
	internal, outer := "tls_inspect_internal_agent-signed", "agent_egress_agent-signed"
	r := &AgentReconciler{}
	now := time.Now()

	first, err := renderOwnerGateway(agents, cfg, r.ownerGatewayRepairPlan(testOwner, names, now))
	require.NoError(t, err)
	late := missingClusters(t, resourcesNamed(t, first.LDS, internal), resourcesNamed(t, first.LDS, outer), bootstrapClusterNames(t, first.Bootstrap)...)
	require.Equal(t, []string{"upstream_platform-conn-cos_b655210f_agent-signed"}, late, "the upstream cluster a new signing chain needs is the one the pod does not have")
	pod := newFakeOwnerEnvoy(append(bootstrapClusterNames(t, first.Bootstrap), clusterNames(t, first.CDS)...)...)
	pod.withhold(late...)
	pod.project(t, first.LDS)
	assert.True(t, pod.refused(internal), "its upstream cluster is not there yet")
	require.True(t, pod.answers(outer))
	assert.Equal(t, first.Revisions["agent-signed"], pod.healthBody(t, outer), "the outer listener answers the current revision while the chains are missing")

	// TEST_SCENARIO: the cluster arrives, and a plain render of the same files is byte-identical, so the pod reads nothing new and the chains stay missing.
	pod.deliver(late...)
	plain, err := renderOwnerGateway(agents, cfg, nil)
	require.NoError(t, err)
	pod.project(t, plain.LDS)
	assert.True(t, pod.refused(internal), "a refused listener stays missing without a new file to read")

	repaired, err := renderOwnerGateway(agents, cfg, r.ownerGatewayRepairPlan(testOwner, names, now.Add(ownerGatewayReapplySchedule[0])))
	require.NoError(t, err)
	pod.project(t, repaired.LDS)
	assert.False(t, pod.refused(internal), "the files moved, so the listener was offered again, with its cluster there")
}

// UNIT_BOUNDARY_DESCRIPTION: what a pod of the owner gateway does with the files it is sent. It reads a file only when its content changed, keeps every listener it accepted, so re-reading unchanged files changes nothing, and applies the listeners of one read one at a time: one whose clusters are not all delivered yet is refused and keeps the last good one. A listener it accepts builds its credentials provider from the file mounted at that moment, and a provider whose first read failed never reads that file again.
type fakeOwnerEnvoy struct {
	files     map[string]string
	clusters  map[string]bool
	projected string
	accepted  map[string]string
	missing   map[string]bool
	keys      map[string]string
}

func newFakeOwnerEnvoy(clusters ...string) *fakeOwnerEnvoy {
	e := &fakeOwnerEnvoy{files: map[string]string{}, clusters: map[string]bool{}, accepted: map[string]string{}, missing: map[string]bool{}, keys: map[string]string{}}
	for _, name := range clusters {
		e.clusters[name] = true
	}
	return e
}

func (e *fakeOwnerEnvoy) project(t *testing.T, lds string) {
	t.Helper()
	if e.projected == lds {
		return
	}
	e.projected = lds
	for _, listener := range resourcesOf(t, lds) {
		name, _ := listener["name"].(string)
		content, err := yaml.Marshal(listener)
		require.NoError(t, err)
		if e.accepted[name] == string(content) {
			continue
		}
		if unknown := e.unresolved(t, listener); len(unknown) > 0 {
			delete(e.accepted, name)
			e.missing[name] = true
			continue
		}
		delete(e.missing, name)
		e.accepted[name] = string(content)
		e.keys[name] = e.files[signingFile(t, listener)]
	}
}

func (e *fakeOwnerEnvoy) unresolved(t *testing.T, listener map[string]any) []string {
	t.Helper()
	var unknown []string
	for _, name := range clustersOf(t, mustMarshal(listener)) {
		if !e.clusters[name] {
			unknown = append(unknown, name)
		}
	}
	return unknown
}

func (e *fakeOwnerEnvoy) withhold(clusters ...string) {
	for _, name := range clusters {
		delete(e.clusters, name)
	}
}

func (e *fakeOwnerEnvoy) deliver(clusters ...string) {
	for _, name := range clusters {
		e.clusters[name] = true
	}
}

func (e *fakeOwnerEnvoy) refused(listener string) bool { return e.missing[listener] }

func (e *fakeOwnerEnvoy) answers(listener string) bool { _, ok := e.accepted[listener]; return ok }

func (e *fakeOwnerEnvoy) accessKey(listener string) string { return e.keys[listener] }

func (e *fakeOwnerEnvoy) healthBody(t *testing.T, listener string) string {
	t.Helper()
	var body string
	var walk func(v any)
	walk = func(v any) {
		switch v := v.(type) {
		case map[string]any:
			if direct, ok := v["direct_response"].(map[string]any); ok {
				if inline, ok := direct["body"].(map[string]any); ok {
					body, _ = inline["inline_string"].(string)
				}
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
	var parsed any
	require.NoError(t, yaml.Unmarshal([]byte(e.accepted[listener]), &parsed))
	walk(parsed)
	return body
}

func mustMarshal(v any) string {
	raw, err := yaml.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(raw)
}

func bootstrapClusterNames(t *testing.T, bootstrap string) []string {
	t.Helper()
	var parsed struct {
		StaticResources struct {
			Clusters []struct {
				Name string `json:"name"`
			} `json:"clusters"`
		} `json:"static_resources"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(bootstrap), &parsed))
	var names []string
	for _, cluster := range parsed.StaticResources.Clusters {
		names = append(names, cluster.Name)
	}
	return names
}

func clusterNames(t *testing.T, cds string) []string {
	t.Helper()
	var names []string
	for _, cluster := range resourcesOf(t, cds) {
		if name, ok := cluster["name"].(string); ok {
			names = append(names, name)
		}
	}
	return names
}

func clustersOf(t *testing.T, doc string) []string {
	t.Helper()
	seen := map[string]int{}
	collectStrings(anyOf(t, doc), "cluster", seen)
	out := make([]string, 0, len(seen))
	for name := range seen {
		out = append(out, name)
	}
	slices.Sort(out)
	return out
}

func anyOf(t *testing.T, doc string) any {
	t.Helper()
	var parsed any
	require.NoError(t, yaml.Unmarshal([]byte(doc), &parsed))
	return parsed
}

// UNIT_BOUNDARY_DESCRIPTION: the clusters one listener names that another listener and the bootstrap do not, in name order.
func missingClusters(t *testing.T, listener, other map[string]any, bootstrapped ...string) []string {
	t.Helper()
	elsewhere := map[string]bool{}
	for _, name := range append(clustersOf(t, mustMarshal(other)), bootstrapped...) {
		elsewhere[name] = true
	}
	var out []string
	for _, name := range clustersOf(t, mustMarshal(listener)) {
		if !elsewhere[name] {
			out = append(out, name)
		}
	}
	return out
}

func signingFile(t *testing.T, v any) string {
	t.Helper()
	switch v := v.(type) {
	case map[string]any:
		if source, ok := v["credentials_data_source"].(map[string]any); ok {
			name, _ := source["filename"].(string)
			return name
		}
		for _, nested := range v {
			if file := signingFile(t, nested); file != "" {
				return file
			}
		}
	case []any:
		for _, nested := range v {
			if file := signingFile(t, nested); file != "" {
				return file
			}
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

func resourcesNamed(t *testing.T, doc, name string) map[string]any {
	t.Helper()
	for _, r := range resourcesOf(t, doc) {
		if r["name"] == name {
			return r
		}
	}
	require.FailNow(t, "no resource named "+name)
	return nil
}

func ownerGatewayListenerField(t *testing.T, doc, name string, path ...string) string {
	t.Helper()
	var v any = resourcesNamed(t, doc, name)
	for _, key := range path {
		m, ok := v.(map[string]any)
		require.True(t, ok, "no map at %s in %s", key, name)
		v = m[key]
	}
	got, ok := v.(string)
	require.True(t, ok, "no string at the end of %v in %s", path, name)
	return got
}

// TEST_SCENARIO: a rendering the owner has not written before is re-applied on a fixed schedule, counted from when it was written, so what a pod that never loaded its listener gets is a bounded number of files it reads again rather than a rewrite for as long as the agent lives. A rendering that changes while the attempts are still owed keeps its age, one that changes after they are spent starts an episode of its own, and no two owners' writes — nor two agents' — land closer than the pace, so a flapping sibling cannot postpone a persistent failure's attempts.
func TestOwnerGatewayRepairPlan_ARenderingIsReappliedOnItsSchedule(t *testing.T) {
	start := time.Date(2026, 10, 20, 3, 0, 0, 0, time.UTC)
	names := []string{"agent-a", "agent-b"}
	r := &AgentReconciler{}
	at := func(after time.Duration) (*ownerGatewayRepairPlan, int) {
		now := start.Add(after)
		plan := r.ownerGatewayRepairPlan(testOwner, names, now)
		return plan, plan.generation("agent-a", "rev-1", true)
	}

	plan, generation := at(0)
	assert.Equal(t, 0, generation, "a rendering is sent as it is first")
	assert.Equal(t, ownerGatewayReapplySchedule[0], plan.due["agent-a"], "and is owed the first re-application, three seconds later")

	first, second, third := ownerGatewayReapplySchedule[0], ownerGatewayReapplySchedule[0]+ownerGatewayReapplySchedule[1], ownerGatewayReapplySchedule[0]+ownerGatewayReapplySchedule[1]+ownerGatewayReapplySchedule[2]
	plan, generation = at(first)
	assert.Equal(t, 1, generation, "the re-application is a listener Envoy recreates")
	assert.Equal(t, ownerGatewayReapplySchedule[1]-ownerGatewayReapplySchedule[0], plan.due["agent-a"], "and the next is owed on the schedule, not from the attempt")

	plan, generation = at(first + time.Second)
	assert.Equal(t, 1, generation, "an attempt inside the schedule's wait writes nothing")
	assert.Equal(t, ownerGatewayReapplySchedule[1]-ownerGatewayReapplySchedule[0]-time.Second, plan.due["agent-a"])

	_, generation = at(second)
	assert.Equal(t, 2, generation)
	plan, generation = at(third)
	assert.Equal(t, 3, generation)
	assert.Zero(t, plan.due["agent-a"], "the schedule is spent, so nothing more is owed")

	plan, generation = at(third + time.Minute)
	assert.Equal(t, 3, generation)
	assert.Zero(t, plan.due["agent-a"], "a listener that will not load is not rewritten for as long as the agent lives")

	// TEST_SCENARIO: the pod's answer is not the repair's clock: a mark that comes and goes while the schedule is spent writes nothing, and neither does an answer that stays.
	r.ownerStaleListeners.Store("agent-a", struct{}{})
	plan, generation = at(third + 2*time.Minute)
	assert.Equal(t, 3, generation, "a pod that answers an older revision on a spent schedule is written no more")
	assert.Zero(t, plan.due["agent-a"], "a flapping answer neither resets the schedule nor writes the files")
	r.ownerStaleListeners.Delete("agent-a")

	// TEST_SCENARIO: a rendering that changes under an agent still waiting does not restart its window, and one that changes after the schedule is spent gets attempts of its own.
	r = &AgentReconciler{}
	r.ownerGatewayRepairPlan(testOwner, names, start).generation("agent-a", "rev-1", true)
	now := start.Add(first + 2*time.Second)
	plan = r.ownerGatewayRepairPlan(testOwner, names, now)
	assert.Equal(t, 1, plan.generation("agent-a", "rev-2", true), "the listener the pod has is kept, and the age with it")
	assert.Equal(t, ownerGatewayReapplySchedule[1]-first-2*time.Second, plan.due["agent-a"], "the next attempt is still the one the schedule names")
	for _, wait := range []time.Duration{ownerGatewayReapplySchedule[1] - first - 2*time.Second, ownerGatewayReapplySchedule[2] - ownerGatewayReapplySchedule[1]} {
		now = now.Add(wait)
		plan = r.ownerGatewayRepairPlan(testOwner, names, now)
		plan.generation("agent-a", "rev-2", true)
	}
	now = now.Add(time.Minute)
	plan = r.ownerGatewayRepairPlan(testOwner, names, now)
	assert.Equal(t, 3, plan.generation("agent-a", "rev-3", true))
	assert.Equal(t, ownerGatewayReapplySchedule[0], plan.due["agent-a"], "a new rendering is owed its own schedule")

	// TEST_SCENARIO: two agents owed at the same moment do not write the owner's one ConfigMap together.
	r = &AgentReconciler{}
	now = start.Add(10 * time.Minute)
	plan = r.ownerGatewayRepairPlan(testOwner, []string{"agent-c", "agent-d"}, now)
	assert.Equal(t, 0, plan.generation("agent-c", "rev-1", true))
	assert.Equal(t, 0, plan.generation("agent-d", "rev-1", true))
	now = now.Add(ownerGatewayReapplySchedule[0])
	plan = r.ownerGatewayRepairPlan(testOwner, []string{"agent-c", "agent-d"}, now)
	assert.Equal(t, 1, plan.generation("agent-c", "rev-1", true))
	assert.Equal(t, 0, plan.generation("agent-d", "rev-1", true), "the second agent waits for the pace")
	assert.Equal(t, ownerGatewayReapplyPace, plan.due["agent-d"])
	now = now.Add(ownerGatewayReapplyPace)
	plan = r.ownerGatewayRepairPlan(testOwner, []string{"agent-c", "agent-d"}, now)
	assert.Equal(t, 1, plan.generation("agent-d", "rev-1", true), "and gets its attempt once the pace allows")
}

// TEST_SCENARIO: a rendering the owner writes is re-applied on its schedule, through the reconcile loop: the version the files carry names the attempt, each is written once, and once the schedule is spent a reconcile writes nothing more however often the agent's events arrive.
func TestOwnerGateway_ARenderingIsReappliedOnItsSchedule(t *testing.T) {
	ctx := context.Background()
	r, _, agent := servedVMReconciler(t)
	now := time.Now()
	r.clock = func() time.Time { return now }
	updates := func() int {
		n := 0
		for _, a := range r.client.(*fake.Clientset).Actions() {
			updated, ok := a.(k8stesting.UpdateAction)
			if !ok || a.GetResource().Resource != "configmaps" {
				continue
			}
			if cm, ok := updated.GetObject().(*corev1.ConfigMap); ok && cm.Name == ownerGatewayName("platform", testOwner) {
				n++
			}
		}
		return n
	}
	lds := func() string {
		got, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
		require.NoError(t, err)
		return got.Data[ownerGatewayLDSKey]
	}

	for range 3 {
		require.NoError(t, r.Reconcile(ctx, agent))
	}
	settled := updates()
	for _, wait := range ownerGatewayReapplySchedule {
		now = now.Add(wait)
		require.NoError(t, r.Reconcile(ctx, agent))
		assert.Greater(t, updates(), settled, "the attempt is written")
		assert.Contains(t, lds(), ownerGatewayTemplateRev+"-repair-")
		settled = updates()
	}
	now = now.Add(ownerGatewayReapplyWindow)
	for range 3 {
		require.NoError(t, r.Reconcile(ctx, agent))
	}
	assert.Equal(t, settled, updates(), "past the schedule the owner writes nothing more")
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
	cm, err := r.client.CoreV1().ConfigMaps("test-agents").Get(ctx, ownerGatewayName("platform", testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	assert.Contains(t, cm.Data[ownerGatewayLDSKey], "agent_egress_my-agent", "a hibernated agent keeps its listener")

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
