// TEST_OVERVIEW: the certificate the runner serves names the service the controller dials, and a machine waits for it rather than starting against a name the node cannot verify.
package reconciler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_SCENARIO: the controller trusts a runner by the CA that issued its certificate, so the certificate has to name the Service the controller dials, come from the runners' own CA issuer and never the gateways' MITM one — whose leaves name hosts users choose — and label its Secret so the sweep finds it. A TLS Secret with no CA in it must be refused, because an empty trust pool silently falls back to the system roots.
func TestTheRunnerCertificateNamesTheServiceTheControllerDials(t *testing.T) {
	r, _ := setupReconciler(t, vmAgentCR())
	r.config.EnvoyMitmCAIssuer = "platform-mitm-ca-issuer"
	r.config.VMRunnerCAIssuer = "platform-vm-runner-ca-issuer"

	cert := r.buildRunnerCertificate(testOwner, nil)
	assert.Equal(t, []string{r.runnerHost(testOwner)}, cert.Spec.DNSNames, "the cert names the Service the controller dials")
	assert.Equal(t, r.runnerTLSName(testOwner), cert.Spec.SecretName)
	assert.Equal(t, "platform-vm-runner-ca-issuer", cert.Spec.IssuerRef.Name)
	assert.Equal(t, "ClusterIssuer", cert.Spec.IssuerRef.Kind)
	assert.Equal(t, vmRunnerComponent, cert.Spec.SecretTemplate.Labels["app.kubernetes.io/component"])

	ctx := context.Background()
	tls := runnerTLSSecret()
	delete(tls.Data, "ca.crt")
	for _, sec := range []*corev1.Secret{runnerSecret(), tls} {
		_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, sec, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	_, err := r.runnerFor(ctx, testOwner)
	require.ErrorContains(t, err, "no ca.crt")

	_, err = vmrunner.NewClient("https://x:4600", "token", "not-a-cert")
	require.Error(t, err, "and refuses to dial with something that is not a certificate")
}

// TEST_SCENARIO: a new owner's runner cannot serve until cert-manager issues its certificate, and its pod cannot mount the Secret before then. The reconcile requeues, as it does for a gateway's leaf, rather than marking the Agent failed, and no machine is asked for.
func TestVMBackendWaitsForTheRunnerCertificate(t *testing.T) {
	agent := vmAgentCR()
	node, srv := newFakeNode(t)
	agent.Labels = map[string]string{envoyOwnerLabel: testOwner}
	r, _ := setupReconciler(t, agent, leafSecret(), readyRunnerDeployment(), runnerSecret())
	r.config.VM = config.VMConfig{Enabled: true, Runner: config.VMRunnerSpec{Image: "vm-runner:1", Storage: "100Gi", ImageCacheBudget: "50Gi", ImageCacheHostPath: "/var/lib/platform-images"}}
	r.runnerEndpoint = func(string) string { return srv.URL }

	err := r.Reconcile(context.Background(), agent)
	require.ErrorIs(t, err, errRunnerTLSPending)
	assert.Empty(t, node.specs)
	_, err = r.dynamic.Resource(certificateGVR).Namespace("test-agents").Get(context.Background(), r.runnerTLSName(testOwner), metav1.GetOptions{})
	require.NoError(t, err, "the certificate is asked for on the same pass")
}
