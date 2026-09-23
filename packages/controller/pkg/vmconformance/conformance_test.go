// TEST_OVERVIEW: the machine API conformance suite, run against a runner driving a real VMM, reached over its machine API with the token and CA the controller would use. The cluster task names the runner through the environment; with nothing named there is nothing to run and the test skips. It covers create to ready, stop and start keeping the disk, a revision restart, the egress and capacity refusals, delete, and a runner restart republishing the port.
package vmconformance

import (
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	envURL        = "VMRUNNER_CONFORMANCE_URL"
	envToken      = "VMRUNNER_CONFORMANCE_TOKEN"
	envCA         = "VMRUNNER_CONFORMANCE_CA_FILE"
	envServerName = "VMRUNNER_CONFORMANCE_SERVER_NAME"
	envImage      = "VMRUNNER_CONFORMANCE_IMAGE"
	envMemory     = "VMRUNNER_CONFORMANCE_MEMORY_MIB"
	envReady      = "VMRUNNER_CONFORMANCE_READY_TIMEOUT"
	envRestart    = "VMRUNNER_CONFORMANCE_RESTART"
	envPublished  = "VMRUNNER_CONFORMANCE_PUBLISHED_HOST"
)

// TEST_SCENARIO: a runner driving a real VMM, reached over its machine API with the token and CA the controller would use. The suite's cluster task names it; with nothing named there is nothing to run.
func TestLiveRunnerConforms(t *testing.T) {
	url := os.Getenv(envURL)
	if url == "" {
		t.Skipf("%s names no runner", envURL)
	}
	caPEM := ""
	if path := os.Getenv(envCA); path != "" {
		b, err := os.ReadFile(path)
		require.NoError(t, err)
		caPEM = string(b)
	}
	client, err := vmrunner.NewClient(url, os.Getenv(envToken), caPEM)
	require.NoError(t, err)
	if name := os.Getenv(envServerName); name != "" {
		transport := client.HTTP.Transport.(*http.Transport)
		require.NotNil(t, transport.TLSClientConfig, "%s needs %s", envServerName, envCA)
		transport.TLSClientConfig.ServerName = name
	}
	target := Target{Client: client, Image: os.Getenv(envImage)}
	if mib := os.Getenv(envMemory); mib != "" {
		target.MemoryMiB, err = strconv.Atoi(mib)
		require.NoError(t, err)
	}
	if ready := os.Getenv(envReady); ready != "" {
		target.Ready, err = time.ParseDuration(ready)
		require.NoError(t, err)
	}
	if command := os.Getenv(envRestart); command != "" {
		target.Restart = func(t *testing.T) {
			out, err := exec.CommandContext(t.Context(), "sh", "-c", command).CombinedOutput()
			require.NoError(t, err, "restarting the runner: %s", out)
		}
	}
	if host := os.Getenv(envPublished); host != "" {
		target.Published = func(port int) string { return net.JoinHostPort(host, strconv.Itoa(port)) }
	}
	Run(t, target)
}
