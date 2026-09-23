package reconciler

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TEST_OVERVIEW: the controller meets the vm runner and platform-init, which are Rust, across two contracts that no compiler checks: the args it renders into the runner's Deployment, and the guest paths it writes into the agent's environment. Each is a JSON fixture beside the runner, and the runner's own tests read the same files, so a change on either side fails that side's tests rather than a runner pod or a guest.

func readRunnerContract(t *testing.T, name string, into any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vm-runner", "contract", name))
	require.NoError(t, err)
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	require.NoError(t, decoder.Decode(into), "%s does not decode into what the controller writes", name)
}

func renderedRunnerArgs(t *testing.T) []string {
	t.Helper()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.IngressCIDRs = []string{"10.0.0.0/8", "fd00::/8"}
	require.NoError(t, r.Reconcile(context.Background(), agent))
	dep, err := r.client.AppsV1().Deployments("test-agents").Get(
		context.Background(), r.runnerName(testOwner), metav1.GetOptions{})
	require.NoError(t, err)
	return dep.Spec.Template.Spec.Containers[0].Args
}

// TEST_SCENARIO: the runner parses these args at start, and a flag it does not know is a runner pod that exits rather than a failed build. The fixture is what the runner's tests parse, together with its image's ENTRYPOINT, so the args rendered here must be exactly the fixture; a change to them updates the fixture, and the runner's tests then say whether it still starts.
func TestTheRunnerIsStartedWithTheArgsItsContractNames(t *testing.T) {
	var want []string
	readRunnerContract(t, "runner-args.json", &want)
	assert.Equal(t, want, renderedRunnerArgs(t))
}

// TEST_SCENARIO: the runner publishes each machine on a port from the range its args name, and the NetworkPolicy admits the api-server to exactly the range it opens. Two ranges that differ leave a machine the api-server cannot dial, with nothing in any status saying why, so both are rendered from one pair of constants and held equal here.
func TestTheRunnerPublishesMachinesOnlyOnPortsItsPolicyOpens(t *testing.T) {
	flag := func(args []string, name string) int {
		for _, arg := range args {
			if value, ok := strings.CutPrefix(arg, "--"+name+"="); ok {
				n, err := strconv.Atoi(value)
				require.NoError(t, err)
				return n
			}
		}
		t.Fatalf("the runner's args set no --%s", name)
		return 0
	}
	args := renderedRunnerArgs(t)

	np := buildRunnerNetworkPolicy(testOwner, "platform", "platform", "test-agents", "platform", 10000, nil, nil)
	published := np.Spec.Ingress[0].Ports[1]
	require.NotNil(t, published.Port)
	require.NotNil(t, published.EndPort)
	assert.Equal(t, flag(args, "port-min"), published.Port.IntValue())
	assert.Equal(t, flag(args, "port-max"), int(*published.EndPort))
}

// TEST_SCENARIO: two guest paths are named by the controller and laid out by platform-init: the agent home, which the controller sets as HOME and platform-init bind-mounts the disk onto, and the CA file, which the controller names in NODE_EXTRA_CA_CERTS and platform-init binds from the machine's share. Neither side can import the other's constant, so both are held to one fixture — a home nobody mounts loses the agent's work at the first stop, and a CA file that is not there fails every intercepted TLS call.
func TestTheAgentsGuestPathsAreTheOnesPlatformInitLaysOut(t *testing.T) {
	var guest struct {
		AgentHome string `json:"agentHome"`
		CAFile    string `json:"caFile"`
	}
	readRunnerContract(t, "guest.json", &guest)

	assert.Equal(t, guest.AgentHome, agentHomeDir)
	env := envToMap(agentPlatformEnv("my-agent", testConfig, agentHomeDir, "http://10.96.42.42:10000"))
	assert.Equal(t, guest.CAFile, env["NODE_EXTRA_CA_CERTS"])
}
