package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	sigsyaml "sigs.k8s.io/yaml"
)

// TEST_SCENARIO: an agent's leaf is re-issued after its gateway pod mounted it — at create, the grants land a second after the agent and widen the leaf's hosts — and the kubelet swaps the new files in place. Envoy reads a leaf named by plain filenames once, so every terminating chain of an agent's own gateway reads the leaf through an SDS file that watches the leaf's directory, and that file ships in the bootstrap ConfigMap beside the bootstrap that names it.
func TestBuildEnvoyBootstrapConfigMap_TheLeafIsReadThroughAWatchedSDSFile(t *testing.T) {
	owner := metav1.OwnerReference{APIVersion: "v1", Kind: "ConfigMap", Name: "owner", UID: "uid"}
	secret := withHostSDS(credSecret("platform-conn-echo", "httpbingo.org"), "httpbingo.org")

	cm, err := BuildEnvoyBootstrapConfigMap("inst-1", "", bootstrapTestCfg, owner, []corev1.Secret{secret}, nil, false)
	require.NoError(t, err)

	bootstrap := cm.Data["envoy.yaml"]
	assert.Contains(t, bootstrap, "name: terminate_chain_platform-conn-echo_", "the connection's host has a terminating chain")
	assert.NotContains(t, bootstrap, "filename: "+envoyLeafTLSMount+"/tls.crt",
		"a leaf named by filename is read once and never again when cert-manager re-issues it")
	assert.Contains(t, bootstrap, "tls_certificate_sds_secret_configs")
	assert.Contains(t, bootstrap, "path: "+"/etc/envoy/leaf-sds.yaml")

	var sds struct {
		Resources []struct {
			Name           string `json:"name"`
			TLSCertificate struct {
				CertificateChain struct{ Filename string } `json:"certificate_chain"`
				PrivateKey       struct{ Filename string } `json:"private_key"`
				WatchedDirectory struct{ Path string }     `json:"watched_directory"`
			} `json:"tls_certificate"`
		} `json:"resources"`
	}
	require.Contains(t, cm.Data, "leaf-sds.yaml", "the SDS file the bootstrap names is in the volume it mounts")
	require.NoError(t, sigsyaml.Unmarshal([]byte(cm.Data["leaf-sds.yaml"]), &sds))
	require.Len(t, sds.Resources, 1)
	leaf := sds.Resources[0]
	assert.Equal(t, envoyLeafSDSName, leaf.Name)
	assert.Equal(t, envoyLeafTLSMount+"/tls.crt", leaf.TLSCertificate.CertificateChain.Filename)
	assert.Equal(t, envoyLeafTLSMount+"/tls.key", leaf.TLSCertificate.PrivateKey.Filename)
	assert.Equal(t, envoyLeafTLSMount, leaf.TLSCertificate.WatchedDirectory.Path,
		"the kubelet swaps a Secret volume by moving its ..data link, which a watch on the directory sees")
}
