// TEST_OVERVIEW: each owner gets one runner, owned by its own service account, reached only by that owner and its gateways, and swept when it holds no machine.
package reconciler

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// TEST_SCENARIO: an install switched from runner pods to the host runner still holds the runner Deployment it made for an owner before, whose pod can never schedule without a KVM device. The host-mode sweep removes that Deployment and keeps its claim, which holds the disks of the machines it ran, and leaves the host runner's own Secret, whose name a per-owner lookup would resolve to in host mode, alone.
func TestTheHostRunnerSweepDropsRunnerPodsLeftFromBefore(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	podRunner := r.runnerName(testOwner)
	_, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, podRunner, metav1.GetOptions{})
	require.NoError(t, err, "the runner pod's Deployment exists before the switch")

	r.config.VM.Runner.HostAddress = "192.168.5.2"
	hostSecret := runnerSecret()
	hostSecret.Name = r.runnerName(testOwner)
	_, err = r.client.CoreV1().Secrets("test-agents").Create(ctx, hostSecret, metav1.CreateOptions{})
	require.NoError(t, err)

	r.ReconcileOrphanMachines(ctx)

	_, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, podRunner, metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "the runner pod left from before is removed")
	_, err = r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, podRunner, metav1.GetOptions{})
	assert.NoError(t, err, "its claim, holding its machines' disks, is kept")
	_, err = r.client.CoreV1().Secrets("test-agents").Get(ctx, hostSecret.Name, metav1.GetOptions{})
	assert.NoError(t, err, "the host runner's own Secret is left alone")
}

// TEST_SCENARIO: two owners' vm agents: each owner's machines land on a runner of their own — a separate Deployment, disk and credentials — so one owner's guest cannot reach another's, and the runner's ingress policy admits only the platform.
func TestEachOwnerGetsTheirOwnRunner(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()

	_, _, err := r.ensureRunner(ctx, "owner-a")
	require.ErrorIs(t, err, errRunnerTLSPending, "a runner is not dialled before cert-manager issues its certificate")
	_, _, err = r.ensureRunner(ctx, "owner-b")
	require.ErrorIs(t, err, errRunnerTLSPending)

	a, b := r.runnerName("owner-a"), r.runnerName("owner-b")
	assert.NotEqual(t, a, b, "one runner per owner")
	for _, name := range []string{a, b} {
		dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, int32(1), *dep.Spec.Replicas)
		pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, "100Gi", pvc.Spec.Resources.Requests.Storage().String())
		_, err = r.client.CoreV1().Services("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		np, err := r.client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, name+"-ingress", metav1.GetOptions{})
		require.NoError(t, err)
		assert.Len(t, np.Spec.Ingress[0].From, 2, "only the api-server and the controller may dial a runner")
	}

	secretA, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, a, metav1.GetOptions{})
	require.NoError(t, err)
	secretB, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, b, metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEqual(t, secretA.Data["token"], secretB.Data["token"], "a runner's token is its own")
	for _, owner := range []string{"owner-a", "owner-b"} {
		cert, err := r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(ctx, r.runnerTLSName(owner), metav1.GetOptions{})
		require.NoError(t, err, "each runner asks cert-manager for a certificate of its own")
		hosts, _, _ := unstructured.NestedStringSlice(cert.Object, "spec", "dnsNames")
		assert.Equal(t, []string{r.runnerHost(owner)}, hosts)
	}

	r.deleteRunner(ctx, "owner-a", false)
	_, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, a, metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "an owner with no vm agents keeps no runner")
	_, err = r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(ctx, r.runnerTLSName("owner-a"), metav1.GetOptions{})
	assert.True(t, k8serrors.IsNotFound(err), "nor a certificate for one")
	_, err = r.client.AppsV1().Deployments("test-agents").Get(ctx, b, metav1.GetOptions{})
	require.NoError(t, err, "and the other owner's runner is untouched")
}

// TEST_SCENARIO: switching virtualization off and on deletes the runner ServiceAccount and renders a new one, which carries a new UID. A controller that resolved the owner once would keep stamping the dead UID, and every object it wrote would be collected the instant it appeared — a runner that never shows up and never explains why.
func TestRunnerOwnershipFollowsARecreatedServiceAccount(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	sas := r.client.CoreV1().ServiceAccounts("test-agents")
	_, err := sas.Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "uid-before"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	require.Equal(t, types.UID("uid-before"), r.runnerOwnerRef(ctx)[0].UID)

	require.NoError(t, sas.Delete(ctx, "platform-vm-runner", metav1.DeleteOptions{}))
	_, err = sas.Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "uid-after"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)

	refs := r.runnerOwnerRef(ctx)
	require.Len(t, refs, 1)
	assert.Equal(t, types.UID("uid-after"), refs[0].UID,
		"a stale UID here is collected by the garbage collector the moment a runner object is written")
}

// TEST_SCENARIO: Helm never sees a runner — the controller creates it — so nothing would remove one on uninstall, on rollback, or when virtualization is switched off. Every object it creates is owned by the ServiceAccount the chart does render, which sits in the same namespace because an owner reference may not cross one; a single object missing the reference strands a running VM. The claim is the exception: it holds every machine disk of the owner, so one deletion of the account must not collect it.
func TestRunnerObjectsAreOwnedByTheRunnerServiceAccount(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	_, err := r.client.CoreV1().ServiceAccounts("test-agents").Create(ctx, &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: "platform-vm-runner", Namespace: "test-agents", UID: "runner-sa-uid"},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	name := r.runnerName(testOwner)
	require.NoError(t, r.client.CoreV1().Secrets("test-agents").Delete(ctx, name, metav1.DeleteOptions{}))

	require.ErrorContains(t, r.Reconcile(ctx, agent), "VM runner", "the fresh token is rejected by the fake runner, which happens after every object below exists")

	owners := map[string][]metav1.OwnerReference{}
	sec, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["secret"] = sec.OwnerReferences
	tls, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, r.runnerTLSName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	owners["tls secret"] = tls.OwnerReferences
	cert, err := r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(ctx, r.runnerTLSName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	owners["certificate"] = cert.GetOwnerReferences()
	pvc, err := r.client.CoreV1().PersistentVolumeClaims("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, pvc.OwnerReferences, "a claim owned by the account loses every disk on it when the account is recreated")
	svc, err := r.client.CoreV1().Services("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["service"] = svc.OwnerReferences
	np, err := r.client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, name+"-ingress", metav1.GetOptions{})
	require.NoError(t, err)
	owners["networkpolicy"] = np.OwnerReferences
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	owners["deployment"] = dep.OwnerReferences

	for kind, refs := range owners {
		require.Len(t, refs, 1, "%s carries no owner, so it would outlive the release", kind)
		assert.Equal(t, types.UID("runner-sa-uid"), refs[0].UID, "%s is owned by the controller", kind)
	}
}

// TEST_SCENARIO: the guest's MITM CA comes from the same leaf Secret the pod mounts; until cert-manager issues it there is nothing to boot with, so the reconcile requeues instead of creating a machine that cannot trust its gateway.
func TestVMBackendWaitsForTheLeafSecret(t *testing.T) {
	agent := vmAgentCR()
	node, srv := newFakeNode(t)
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	r, _ := setupReconciler(t, agent, readyRunnerDeployment(), runnerSecret(), runnerTLSSecret())
	r.config.VM = config.VMConfig{Runner: config.VMRunnerSpec{Image: "vm-runner:1", Storage: "100Gi", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images"}}
	r.runnerEndpoint = func(string) string { return srv.URL }
	err := r.Reconcile(context.Background(), agent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not yet issued")
	assert.Empty(t, node.specs)
}

// TEST_SCENARIO: the sweep needs every runner's token and CA, and runs every ten minutes over every owner. Both of a runner's Secrets carry the component label — the token by the controller, the TLS Secret by cert-manager from the Certificate's template — so one List serves them all and no Secret is read by name.
func TestTheSweepReadsRunnerSecretsInOneList(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	for _, owner := range []string{testOwner, "owner-b"} {
		if owner != testOwner {
			addRunner(t, r, owner)
		}
		for _, name := range []string{r.runnerName(owner), r.runnerTLSName(owner)} {
			sec, err := r.client.CoreV1().Secrets("test-agents").Get(ctx, name, metav1.GetOptions{})
			require.NoError(t, err)
			sec.Labels = vmRunnerLabels(owner, r.config.ReleaseName)
			_, err = r.client.CoreV1().Secrets("test-agents").Update(ctx, sec, metav1.UpdateOptions{})
			require.NoError(t, err)
		}
	}
	fakeClient := r.client.(*fake.Clientset)
	fakeClient.ClearActions()

	runners, err := r.knownRunners(ctx)
	require.NoError(t, err)
	assert.Len(t, runners, 2)
	for _, action := range fakeClient.Actions() {
		assert.False(t, action.GetResource().Resource == "secrets" && action.GetVerb() == "get",
			"a runner Secret was read by name although the List already returned it")
	}
}

// TEST_SCENARIO: the policy confines the runner pod as well as admitting callers, which is the only kernel gate behind a guest's egress allowlist — smolvm enforces that allowlist inside the process an escaped guest would already own. The runner dials nothing but its owner's gateways, so that is all it may reach: no other address, and no resolver, since port 53 open anywhere is a two-way channel from an escaped guest to any host that answers there.
func TestTheRunnerReachesOnlyItsOwnersGateways(t *testing.T) {
	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "default", testConfig.EnvoyPort)
	assert.ElementsMatch(t, []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress}, np.Spec.PolicyTypes)
	require.Len(t, np.Spec.Egress, 1)
	rule := np.Spec.Egress[0]
	require.Len(t, rule.To, 1)
	to := rule.To[0]
	assert.Nil(t, to.IPBlock)
	assert.Equal(t, RoleGateway, to.PodSelector.MatchLabels[LabelRole])
	assert.Equal(t, testOwner, to.PodSelector.MatchLabels[envoyOwnerLabel],
		"only this owner's gateways — another owner's hold credentials this runner's guests must never borrow")
	assert.Equal(t, "test-agents", to.NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"],
		"gateways are reached in the agent namespace, not the release namespace")
	var ports []string
	for _, p := range rule.Ports {
		ports = append(ports, fmt.Sprintf("%s/%d", *p.Protocol, p.Port.IntVal))
	}
	assert.ElementsMatch(t, []string{fmt.Sprintf("TCP/%d", testConfig.EnvoyPort), "UDP/10053", "TCP/10053"}, ports,
		"the proxy port and the machine resolver: nothing else on a gateway is meant for a guest")
}
