// TEST_OVERVIEW: the machine API conformance suite, run two ways. Against the Go runner in this process, over a fake VMM that boots the probe guest as a real process with a real disk directory — the fast run CI has, which needs no KVM. And against a live runner named by the environment, which is how the suite reaches a runner driving a real VMM; that run is skipped when no runner is named.
package vmconformance

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
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

	fakeImage = "quay.io/conformance/probe:1"
	// UNIT_BOUNDARY_DESCRIPTION: published ports the in-process runner is given. The suite holds at most two machines at once — the one a case is on and, briefly, the one a finished case is still deleting.
	fakePorts = 3
)

func TestMain(m *testing.M) {
	switch os.Getenv(fakeRole) {
	case roleSmolvm:
		os.Exit(fakeSmolvm(os.Args[1:]))
	case roleGuest:
		os.Exit(fakeGuest())
	}
	os.Exit(m.Run())
}

// TEST_SCENARIO: the Go runner is the production runner and the reference every other implementation is held to, so it must pass the whole suite. The VMM behind it is fake, which is what lets this run anywhere, but the runner is not: every request goes through its HTTP handler, its planning, its capacity admission and its forwarder.
func TestGoRunnerConformsOverAFakeVMM(t *testing.T) {
	r := newInProcessRunner(t)
	Run(t, Target{
		Client:    r.client(t),
		Image:     fakeImage,
		MemoryMiB: 512,
		Ready:     20 * time.Second,
		Restart:   r.restart,
		Published: func(port int) string { return fmt.Sprintf("127.0.0.1:%d", port) },
	})
}

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

type inProcessRunner struct {
	owner    *testing.T
	dir      string
	base     int
	vmm      fakeVMM
	front    *httptest.Server
	current  atomic.Pointer[vmrunner.Server]
	mu       sync.Mutex
	reserved map[int]net.Listener
}

func newInProcessRunner(t *testing.T) *inProcessRunner {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	r := &inProcessRunner{owner: t, dir: dir, vmm: fakeVMM{dir: filepath.Join(dir, "vmm")}, reserved: map[int]net.Listener{}}
	require.NoError(t, os.MkdirAll(r.vmm.dir, 0o755))
	t.Setenv(envVMMDir, r.vmm.dir)
	t.Cleanup(r.vmm.haltAll)
	r.reservePorts(t)

	self, err := os.Executable()
	require.NoError(t, err)
	writeTool(t, filepath.Join(dir, "smolvm"), fmt.Sprintf("#!/bin/sh\n%s=%s exec '%s' \"$@\"\n", fakeRole, roleSmolvm, self))
	writeTool(t, filepath.Join(dir, "crane"), fakeCrane)
	writeTool(t, filepath.Join(dir, "platform-init"), "#!/bin/sh\nexec \"$@\"\n")

	r.start(t)
	r.front = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.current.Load().Handler().ServeHTTP(w, req)
	}))
	t.Cleanup(r.front.Close)
	return r
}

// UNIT_BOUNDARY_DESCRIPTION: the image the fake crane serves names the probe guest's own entrypoint, because the runner refuses an image that names nothing to run. The fake VMM ignores the command line it is given and boots the guest itself.
const fakeCrane = "#!/bin/sh\n" +
	"if [ \"$1\" = config ]; then printf '{\"config\":{\"Entrypoint\":[\"/probe\"]}}'; exit 0; fi\n" +
	"d=$(mktemp -d); echo probe > \"$d/probe\"; tar -cf - -C \"$d\" .; rm -rf \"$d\"\n"

func writeTool(t *testing.T, path, body string) {
	t.Helper()
	require.NoError(t, os.WriteFile(path, []byte(body), 0o755))
}

// UNIT_BOUNDARY_DESCRIPTION: each published port is held from the moment it is found free until the runner binds it, and handed over rather than released, so nothing else on the host can take it in between. Its guest port, at the runner's loopback offset, cannot be held the same way — a held listener would answer the runner's health check itself — so it is only checked free, and a guest that loses the race fails its boot loudly.
func (r *inProcessRunner) reservePorts(t *testing.T) {
	t.Helper()
	const offset = 1000
	for attempt := range 200 {
		base := 23000 + (os.Getpid()+attempt)%(offset/fakePorts)*fakePorts
		held := map[int]net.Listener{}
		ok := true
		for p := base; p < base+fakePorts && ok; p++ {
			ln, err := net.Listen("tcp", fmt.Sprintf(":%d", p))
			if err != nil {
				ok = false
				break
			}
			held[p] = ln
			free, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p+offset))
			if err != nil {
				ok = false
				break
			}
			free.Close()
		}
		if ok {
			r.base, r.reserved = base, held
			t.Cleanup(r.releasePorts)
			return
		}
		for _, ln := range held {
			ln.Close()
		}
	}
	t.Fatal("no free block of ports for the in-process runner")
}

func (r *inProcessRunner) releasePorts() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for p, ln := range r.reserved {
		ln.Close()
		delete(r.reserved, p)
	}
}

func (r *inProcessRunner) listen(network, address string) (net.Listener, error) {
	_, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(portText)
	r.mu.Lock()
	ln, held := r.reserved[port]
	delete(r.reserved, port)
	r.mu.Unlock()
	if held {
		return ln, nil
	}
	return net.Listen(network, address)
}

func (r *inProcessRunner) start(t *testing.T) {
	t.Helper()
	srv := &vmrunner.Server{
		Token: "conformance", StateDir: filepath.Join(r.dir, "machines"), ImageDir: filepath.Join(r.dir, "images"),
		Runtime: &vmrunner.Smolvm{Bin: filepath.Join(r.dir, "smolvm")}, PortMin: r.base, PortMax: r.base + fakePorts - 1,
		MemoryMiB: 4096, Crane: filepath.Join(r.dir, "crane"), Init: filepath.Join(r.dir, "platform-init"), Listen: r.listen,
	}
	require.NoError(t, srv.Start())
	r.owner.Cleanup(srv.Close)
	r.current.Store(srv)
}

// UNIT_BOUNDARY_DESCRIPTION: a new runner process on the same state directory, behind the same address. The guests are left running, as VMs outlive the runner process that started them on a host where nothing else stops them.
func (r *inProcessRunner) restart(t *testing.T) {
	r.current.Load().Close()
	r.start(t)
}

func (r *inProcessRunner) client(t *testing.T) *vmrunner.Client {
	t.Helper()
	c, err := vmrunner.NewClient(r.front.URL, "conformance", "")
	require.NoError(t, err)
	return c
}
