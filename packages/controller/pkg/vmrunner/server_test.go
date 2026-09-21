// TEST_OVERVIEW: the VM runner turns the controller's desired machine (shape + power state) into smolvm CLI calls and reports the machine back. What must hold: a bearer token gates every call; an absent machine that should run is created with its published port, CA mount, egress allowlist and env, then started; a stopped one is re-shaped in place and started; a running one that should stop is stopped; a change of size, env, CA or restart revision restarts the machine (stop, update, start) without recreating it; a machine that was healthy and then stops answering is stopped and started again, but only after a window no legitimate boot reaches, and every state change restarts that window so a slow wake is never cut short; the image and egress allow-list are fixed at create, so a change to either is reported and the rest of the spec still applies; a start first recovers whatever an unclean stop left (smolvm reports such a machine unreachable, and its root overlay — throwaway by contract, only the storage disk persists — can come back dirty and make the boot exit at once, in which case it is discarded and the start retried; a clean overlay is kept because recreating one costs most of smolvm's ready window) and leaves no guest process behind when smolvm gives up on it; delete waits for the in-flight operation, removes the machine and frees its port; ports are unique on the node; only allowed sources may dial a published port; a machine is admitted only when the runner has the memory for it, and a guest the runner had to restart is counted so the platform can tell a reboot from a slow start.
package vmrunner

import (
	"archive/tar"
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const fakeSmolvm = `#!/bin/sh
echo "$@" >> "$FAKE_LOG"
case "$2" in
  status)
    name=$4
    [ -f "$FAKE_STATE/$name" ] || { echo "machine '$name' not found" >&2; exit 1; }
    echo "{\"state\":\"$(cat "$FAKE_STATE/$name")\"}" ;;
  create) echo created > "$FAKE_STATE/$4" ;;
  start) [ -n "$FAKE_START_SLEEP" ] && sleep "$FAKE_START_SLEEP"
    if [ -n "$FAKE_START_FAIL_ONCE" ] && [ ! -f "$FAKE_STATE/.failed-once" ]; then touch "$FAKE_STATE/.failed-once"; echo "$FAKE_START_FAIL_ONCE" >&2; exit 1; fi
    echo running > "$FAKE_STATE/$4" ;;
  stop) [ -n "$FAKE_STOP_SLEEP" ] && sleep "$FAKE_STOP_SLEEP"
    echo stopped > "$FAKE_STATE/$4" ;;
  delete) rm -f "$FAKE_STATE/$4" ;;
esac
`

type harness struct {
	srv   *httptest.Server
	node  *Server
	log   string
	state string
	init  string
}

// UNIT_BOUNDARY_DESCRIPTION: ports this test binary has bound and not yet handed to the code under test. They are held rather than probed: a port proven free and then released is only a port that used to be free, and in between the runner's own published port can be taken by anything else on the host — which reads as a machine that failed to boot rather than as a test that lost a race. Whoever needs one claims the listener itself, so the port is never unbound in between.
const (
	firstBase = 20000
	// UNIT_BOUNDARY_DESCRIPTION: published ports per harness — one per machine of the two its range allows.
	portsPerHarness = 2
)

var reservations = struct {
	sync.Mutex
	held map[int]net.Listener
}{held: map[int]net.Listener{}}

// UNIT_BOUNDARY_DESCRIPTION: takes the reservation for a port, or nothing if this binary never held it — code asking for an unreserved port binds it the ordinary way, which is what the runner does in production.
func claimPort(port int) net.Listener {
	reservations.Lock()
	defer reservations.Unlock()
	ln := reservations.held[port]
	delete(reservations.held, port)
	return ln
}

// UNIT_BOUNDARY_DESCRIPTION: one harness is given a range of two machines, and each machine needs two ports: the published one, which the runner binds on every interface, and the guest's at +loopbackOffset, which the fake guest binds on loopback. Each is therefore reserved on the address its eventual owner will bind — a port free on loopback can still be taken on another interface, so proving the narrower one proves less than it looks. Bases are drawn only from the first loopbackOffset ports of the range, which is what keeps one harness's guest ports out of another's published ones; and the first base tried is keyed to this process, walking on from there, so two test binaries at once begin at different bases rather than drawing from one distribution. An earlier version added the process id to a fresh random draw each attempt, which is uniform whatever is added to it — the keying was in the comment and not in the code.
func freePort(t *testing.T) int {
	t.Helper()
	bases := loopbackOffset / portsPerHarness
	for attempt := range 200 {
		base := firstBase + (os.Getpid()+attempt)%bases*portsPerHarness
		taken := make([]int, 0, portsPerHarness)
		for _, port := range []int{base, base + 1} {
			ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
			if err != nil {
				break
			}
			reservations.Lock()
			reservations.held[port] = ln
			reservations.Unlock()
			taken = append(taken, port)
		}
		if len(taken) < portsPerHarness || !guestPortsFree(base) {
			releasePorts(taken)
			continue
		}
		t.Cleanup(func() { releasePorts(taken) })
		return base
	}
	t.Fatal("no free port block for the harness")
	return 0
}

func portOf(t *testing.T, address string) int {
	t.Helper()
	_, portText, err := net.SplitHostPort(address)
	require.NoError(t, err)
	port, err := strconv.Atoi(portText)
	require.NoError(t, err)
	return port
}

// UNIT_BOUNDARY_DESCRIPTION: the guest ports of a base, checked the way a port has to be checked when it cannot be held: bound and let go. Holding one is what the published ports do and it is wrong here — a held listener still completes a connection, into a backlog nothing is serving, and the runner's own readiness check dials exactly this port. It would read a reservation as a guest that had answered, and hand the connection to the fake guest when it took the listener over. So this is a probe, with the race a probe carries; the fake guest binds for real and fails loudly if it lost, rather than flaking.
func guestPortsFree(base int) bool {
	for _, port := range []int{base + loopbackOffset, base + 1 + loopbackOffset} {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			return false
		}
		ln.Close()
	}
	return true
}

// UNIT_BOUNDARY_DESCRIPTION: closes whatever of a reservation is still held. A port already claimed is not closed here, because the code under test owns it by then and closes it itself.
func releasePorts(ports []int) {
	for _, port := range ports {
		if ln := claimPort(port); ln != nil {
			ln.Close()
		}
	}
}

// TEST_OVERVIEW: stands in for a guest listening on its loopback port, so a test can tell "the runner refused this source" apart from "nothing was listening" — the two look identical from the client end.
func fakeGuest(t *testing.T, port int) func() int {
	t.Helper()
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	require.NoError(t, err)
	t.Cleanup(func() { ln.Close() })
	var mu sync.Mutex
	served := 0
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			served++
			mu.Unlock()
			c.Write([]byte("hello"))
			c.Close()
		}
	}()
	return func() int {
		mu.Lock()
		defer mu.Unlock()
		return served
	}
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "smolvm")
	require.NoError(t, os.WriteFile(bin, []byte(fakeSmolvm), 0o755))
	init := filepath.Join(dir, "platform-init")
	require.NoError(t, os.WriteFile(init, []byte("#!/bin/sh\nexec \"$@\"\n"), 0o755))
	crane := filepath.Join(dir, "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(filepath.Join(dir, "crane.log"))), 0o755))
	h := &harness{log: filepath.Join(dir, "log"), state: filepath.Join(dir, "state"), init: init}
	require.NoError(t, os.MkdirAll(h.state, 0o755))
	t.Setenv("FAKE_LOG", h.log)
	t.Setenv("FAKE_STATE", h.state)
	first := freePort(t)
	h.node = &Server{
		Token: "secret", StateDir: filepath.Join(dir, "machines"), ImageDir: filepath.Join(dir, "images"), Runtime: &Smolvm{Bin: bin},
		PortMin: first, PortMax: first + 1, MemoryMiB: 1 << 20, Init: init, Crane: crane,
	}
	h.node.Listen = func(network, address string) (net.Listener, error) {
		if ln := claimPort(portOf(t, address)); ln != nil {
			return ln, nil
		}
		return net.Listen(network, address)
	}
	require.NoError(t, h.node.Start())
	t.Cleanup(h.node.Close)
	h.srv = httptest.NewServer(h.node.Handler())
	t.Cleanup(h.srv.Close)
	return h
}

func (h *harness) client() *Client {
	c, _ := NewClient(h.srv.URL, "secret", "")
	return c
}

func (h *harness) calls() string {
	b, _ := os.ReadFile(h.log)
	var ops []string
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if line != "" && !strings.HasPrefix(line, "machine status") {
			ops = append(ops, line)
		}
	}
	return strings.Join(ops, "\n") + "\n"
}

func (h *harness) settle(t *testing.T, id string) MachineStatus {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		st, err := h.client().Status(t.Context(), id)
		require.NoError(t, err)
		switch st.State {
		case StateCreating, StateStarting, StateStopping, StateRestarting:
		default:
			return st
		}
		require.True(t, time.Now().Before(deadline), "operation never finished: %+v", st)
		time.Sleep(10 * time.Millisecond)
	}
}

func spec(running bool) MachineSpec {
	return MachineSpec{Image: "quay.io/x/vm:1", CPUs: 2, MemoryMiB: 2048, StorageGiB: 5, Running: running, Revision: "r1",
		Env: map[string]string{"HTTPS_PROXY": "http://10.0.0.1:10000", "A": "b"}, CACert: "PEM", AllowCIDRs: []string{"10.0.0.1/32"}}
}

// TEST_SCENARIO: the controller is the only caller; a request without its token gets nothing, not even a status.
func TestRejectsWrongToken(t *testing.T) {
	h := newHarness(t)
	req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/machines/a", nil)
	req.Header.Set("Authorization", "Bearer nope")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	resp.Body.Close()

	req, _ = http.NewRequest(http.MethodPut, h.srv.URL+"/machines/Bad_Name", bytes.NewBufferString("{}"))
	req.Header.Set("Authorization", "Bearer secret")
	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp.Body.Close()
}

// TEST_OVERVIEW: answers on the guest's loopback port the way a booted guest does, so a test can say when the platform could have known the agent was up.
func guestServing(t *testing.T, port int) {
	t.Helper()
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	require.NoError(t, err)
	t.Cleanup(func() { ln.Close() })
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
}

// TEST_SCENARIO: the runtime's start call lingers seconds past the moment the guest begins serving, and the platform used to spend every one of them telling the user their agent was not ready. The guest answers here while the start is still running, and the machine must be called ready on the strength of that answer alone — the assertion that it is still starting is the point, since a status that only turned ready after the call returned would satisfy the first half.
func TestAGuestThatAnswersIsReadyBeforeItsStartReturns(t *testing.T) {
	t.Setenv("FAKE_START_SLEEP", "3")
	h := newHarness(t)
	c := h.client()
	guestServing(t, h.node.PortMin+loopbackOffset)

	st, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	require.Equal(t, StateCreating, st.State)

	var seen MachineStatus
	require.Eventually(t, func() bool {
		got, err := c.Status(t.Context(), "agent-a")
		if err != nil {
			return false
		}
		seen = got
		return got.Ready
	}, 2*time.Second, 10*time.Millisecond, "the guest answered but the machine was never called ready")
	assert.Contains(t, []string{StateCreating, StateStarting}, seen.State,
		"the machine was only called ready once its start had finished, which is the wait this removes")
}

// TEST_SCENARIO: the same answer means nothing on the way down. A machine being stopped keeps answering until it dies, so a stop that is still running must not be read as readiness — otherwise a hibernating agent would report itself ready for as long as its guest took to go.
func TestAGuestAnsweringThroughItsOwnStopIsNotReady(t *testing.T) {
	h := newHarness(t)
	c := h.client()
	guestServing(t, h.node.PortMin+loopbackOffset)

	_, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	require.True(t, h.settle(t, "agent-a").Ready)

	t.Setenv("FAKE_STOP_SLEEP", "2")
	st, err := c.Ensure(t.Context(), "agent-a", spec(false))
	require.NoError(t, err)
	require.Equal(t, StateStopping, st.State)
	for range 20 {
		got, err := c.Status(t.Context(), "agent-a")
		require.NoError(t, err)
		require.False(t, got.Ready, "a machine on its way out was called ready because its guest still answered")
		time.Sleep(10 * time.Millisecond)
	}
}

// TEST_SCENARIO: a vm agent waking for the first time: the machine is created with everything the guest needs to reach only its gateway, then started; the same request again is a no-op that reports the running machine, its port and its applied size.
func TestCreatesAndStartsAnAbsentMachine(t *testing.T) {
	h := newHarness(t)
	c := h.client()

	st, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateCreating, st.State)
	st = h.settle(t, "agent-a")
	assert.Equal(t, StateRunning, st.State)
	assert.Equal(t, h.node.PortMin, st.Port)
	assert.Equal(t, 2, st.CPUs)
	assert.Equal(t, 2048, st.MemoryMiB)
	assert.False(t, st.Ready, "nothing listens on the guest side in this test")

	calls := h.calls()
	assert.Contains(t, calls, "machine create -n agent-a")
	assert.Contains(t, calls, fmt.Sprintf("--cpus 2 --mem 2048 --storage 5 -u root --net --net-backend virtio-net -p %d:8080", h.node.PortMin+loopbackOffset))
	assert.Contains(t, calls, "/agent-a/share:/platform:ro --allow-cidr 10.0.0.1/32")
	assert.Contains(t, calls, "-- /platform/init /entry serve", "platform-init runs first and execs the image's own entrypoint")
	assert.Contains(t, calls, "machine start -n agent-a")

	share := filepath.Join(h.node.StateDir, "agent-a", "share")
	ca, err := os.ReadFile(filepath.Join(share, "ca", "ca.crt"))
	require.NoError(t, err)
	assert.Equal(t, "PEM", string(ca))
	info, err := os.Stat(filepath.Join(share, "init"))
	require.NoError(t, err)
	assert.NotZero(t, info.Mode().Perm()&0o111, "platform-init is copied into the share executable")

	before := h.calls()
	st, err = c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateRunning, st.State)
	assert.NotContains(t, h.calls()[len(before):], "create")
	assert.NotContains(t, h.calls()[len(before):], "stop")
}

// TEST_SCENARIO: hibernate then wake: stopping keeps the machine and its port; the wake re-applies the shape (a template may have changed cpus, memory, env or grown the disk) before starting, dropping env keys that went away. A machine that should not run is never created.
func TestStopsAndRestartsKeepingThePort(t *testing.T) {
	h := newHarness(t)
	c := h.client()
	_, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-a")

	st, err := c.Ensure(t.Context(), "agent-a", spec(false))
	require.NoError(t, err)
	assert.Equal(t, StateStopping, st.State)
	st = h.settle(t, "agent-a")
	assert.Equal(t, StateStopped, st.State)
	assert.Equal(t, h.node.PortMin, st.Port)

	bigger := spec(true)
	bigger.CPUs, bigger.StorageGiB = 4, 8
	delete(bigger.Env, "A")
	_, err = c.Ensure(t.Context(), "agent-a", bigger)
	require.NoError(t, err)
	st = h.settle(t, "agent-a")
	assert.Equal(t, StateRunning, st.State)
	assert.Equal(t, h.node.PortMin, st.Port)
	assert.Equal(t, 4, st.CPUs)
	assert.Contains(t, h.calls(), "machine update -n agent-a --cpus 4 --mem 2048 --storage 8 --remove-env A -e HTTPS_PROXY=http://10.0.0.1:10000")

	_, err = c.Ensure(t.Context(), "agent-b", spec(false))
	require.NoError(t, err)
	assert.NotContains(t, h.calls(), "create -n agent-b", "a machine that should not run is never created")
}

// TEST_SCENARIO: the restart verb rolls the Agent's revision, and a resize or env change lands while the machine runs: each is a stop, an in-place update and a start — never a recreate, so the machine's disk and port stay.
func TestRestartsInPlaceOnRevisionOrShapeChange(t *testing.T) {
	h := newHarness(t)
	c := h.client()
	_, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-a")

	rolled := spec(true)
	rolled.Revision = "r2"
	st, err := c.Ensure(t.Context(), "agent-a", rolled)
	require.NoError(t, err)
	assert.Equal(t, StateRestarting, st.State)
	st = h.settle(t, "agent-a")
	assert.Equal(t, StateRunning, st.State)
	assert.Empty(t, st.Message)
	assert.True(t, strings.HasSuffix(h.calls(), "machine stop -n agent-a\nmachine update -n agent-a --cpus 2 --mem 2048 -e A=b -e HTTPS_PROXY=http://10.0.0.1:10000\nmachine start -n agent-a\n"), h.calls())

	resized := rolled
	resized.MemoryMiB = 4096
	_, err = c.Ensure(t.Context(), "agent-a", resized)
	require.NoError(t, err)
	st = h.settle(t, "agent-a")
	assert.Equal(t, 4096, st.MemoryMiB)
	assert.Zero(t, st.Restarts, "a resize is not a guest that stopped answering")
	assert.Contains(t, h.calls(), "machine update -n agent-a --cpus 2 --mem 4096")
	assert.Equal(t, 1, strings.Count(h.calls(), "machine create"))
	assert.NotContains(t, h.calls(), "delete")
}

// TEST_SCENARIO: ports are the node's scarce resource: two machines never share one, and deleting a machine gives its port back; a delete arriving while a start is still in flight waits for it instead of orphaning the VM.
func TestPortsAreUniqueAndDeleteWaitsForInFlightWork(t *testing.T) {
	h := newHarness(t)
	c := h.client()
	for _, id := range []string{"agent-a", "agent-b"} {
		_, err := c.Ensure(t.Context(), id, spec(true))
		require.NoError(t, err)
		h.settle(t, id)
	}
	assert.Equal(t, h.node.PortMax, h.settle(t, "agent-b").Port)

	_, err := c.Ensure(t.Context(), "agent-c", spec(true))
	require.NoError(t, err)
	st := h.settle(t, "agent-c")
	assert.Equal(t, StateAbsent, st.State)
	assert.Contains(t, st.Message, "no free machine port")

	require.NoError(t, c.Delete(t.Context(), "agent-a"))
	assert.Contains(t, h.calls(), "machine delete -n agent-a -f")
	assert.Equal(t, StateAbsent, h.settle(t, "agent-a").State)

	t.Setenv("FAKE_START_SLEEP", "0.3")
	_, err = c.Ensure(t.Context(), "agent-c", spec(true))
	require.NoError(t, err)
	// UNIT_BOUNDARY_DESCRIPTION: Ensure returns as soon as the operation is queued, so the delete has to arrive while the start is genuinely running or it has nothing to wait for and the test measures its own scheduling instead. smolvm is told what it was asked to do before it sleeps, so its own log says when the start is in flight — which a fixed pause only guessed at, and guessed wrong on a runner slow enough to schedule the goroutine late.
	inFlight := time.Now().Add(5 * time.Second)
	for !strings.Contains(h.calls(), "machine start -n agent-c") {
		require.True(t, time.Now().Before(inFlight), "the start never reached smolvm")
		time.Sleep(time.Millisecond)
	}
	blocked := time.Now()
	require.NoError(t, c.Delete(t.Context(), "agent-c"))
	assert.Greater(t, time.Since(blocked), 200*time.Millisecond,
		"the delete waited out the in-flight start rather than racing it")
	assert.True(t, strings.HasSuffix(h.calls(), "machine start -n agent-c\nmachine delete -n agent-c -f\n"), h.calls())
}

// TEST_SCENARIO: the published port is the guest's only inbound path; with an allow-list only those sources get through, everyone else is dropped at accept. An install with no registry fetch boots a locally loaded archive named after the reference instead, so a dev cluster never needs a registry — and the archive carries the entrypoint platform-init is given, which a bare tree would not.
func TestForwarderHonoursAllowFromAndLocalArchives(t *testing.T) {
	h := newHarness(t)
	_, other, _ := net.ParseCIDR("203.0.113.0/24")
	h.node.AllowFrom = []*net.IPNet{other}
	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-a")

	guest := fakeGuest(t, h.node.PortMin+loopbackOffset)

	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", h.node.PortMin))
	require.NoError(t, err)
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, err = conn.Read(make([]byte, 1))
	require.Error(t, err, "a disallowed source reaches no guest")
	assert.NotContains(t, err.Error(), "timeout", "and is closed rather than left hanging")
	assert.Zero(t, guest(), "nothing was forwarded")

	archive := filepath.Join(h.node.ImageDir, "platform-claude-code-vm_latest.tar")
	fakeArchive(t, archive)
	h.node.Crane = ""
	s := spec(true)
	s.Image = "platform-claude-code-vm:latest"
	_, err = h.client().Ensure(t.Context(), "agent-b", s)
	require.NoError(t, err)
	h.settle(t, "agent-b")
	assert.Contains(t, h.calls(), "-I "+archive)
	assert.Contains(t, h.calls(), "-- /platform/init /entry serve")
}

// TEST_SCENARIO: an allowed caller reaches the guest — the published port carries real bytes from the machine's own loopback listener, which is what the api-server dialing a vm agent depends on.
func TestAnAllowedSourceIsForwardedToTheGuest(t *testing.T) {
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-a")
	guest := fakeGuest(t, h.node.PortMin+loopbackOffset)

	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", h.node.PortMin))
	require.NoError(t, err)
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 5)
	n, err := conn.Read(buf)
	require.NoError(t, err)
	assert.Equal(t, "hello", string(buf[:n]), "the bytes come from the guest, through the published port")
	assert.Equal(t, 1, guest(), "exactly one connection was forwarded")
}

// TEST_SCENARIO: a machine directory holds the sockets and lock of a guest that died with the last pod. Starting the machine stops it for recovery and removes them, keeps the storage disk — the one thing a machine's persistence promises — and discards the root overlay, so a machine that never got a clean stop still wakes onto a fresh root rather than the stale one it crashed with.
func TestStartRecoversAnUncleanlyStoppedMachine(t *testing.T) {
	h := newHarness(t)
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("HOME"), ".cache", "smolvm", "vms", "vm1")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "name"), []byte("m1\n"), 0o644))
	for _, f := range []string{"agent.ready", "vm.lock", "overlay.qcow2", "overlay.formatted", "storage.raw"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, f), nil, 0o644))
	}
	require.NoError(t, os.WriteFile(filepath.Join(h.state, "m1"), []byte("stopped"), 0o644))
	require.NoError(t, h.node.Runtime.Start("m1"))
	for _, f := range []string{"agent.ready", "vm.lock", "overlay.qcow2", "overlay.formatted"} {
		assert.NoFileExists(t, filepath.Join(dir, f))
	}
	assert.FileExists(t, filepath.Join(dir, "storage.raw"), "the storage disk is what survives; only it")
	log, _ := os.ReadFile(h.log)
	assert.Contains(t, string(log), "machine stop -n m1\nmachine start -n m1")
}

// TEST_SCENARIO: a machine's root is a throwaway overlay, and a stop is what throws it away. Keeping it would make persistence two rules instead of one — software installed outside the declared paths would survive an ordinary stop and start, then vanish at some later boot — so the stop that hibernates an agent takes the overlay with it and leaves the storage disk alone.
func TestStoppingAMachineDiscardsItsRootOverlay(t *testing.T) {
	h := newHarness(t)
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("HOME"), ".cache", "smolvm", "vms", "vm1")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "name"), []byte("m1\n"), 0o644))
	for _, f := range []string{"overlay.qcow2", "overlay.formatted", "storage.raw"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, f), nil, 0o644))
	}
	require.NoError(t, os.WriteFile(filepath.Join(h.state, "m1"), []byte("running"), 0o644))

	require.NoError(t, h.node.Runtime.Stop("m1"))
	assert.NoFileExists(t, filepath.Join(dir, "overlay.qcow2"))
	assert.NoFileExists(t, filepath.Join(dir, "overlay.formatted"))
	assert.FileExists(t, filepath.Join(dir, "storage.raw"), "a stopped machine keeps its disk, which is what a wake boots back onto")
}

// TEST_SCENARIO: the runtime expands its disk templates the first time a machine needs one, into a directory that a container throws away with the pod — so the expansion lands on whoever creates the next agent, measured at 24 s. Warming picks exactly the templates that are missing: one already expanded is left alone, so a warm pod does no work, and anything that is not a packed template is none of its business.
func TestOnlyTheTemplatesThatAreMissingAreWarmed(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"storage-template.ext4.zst", "overlay-template.ext4.zst"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("packed"), 0o644))
	}
	require.NoError(t, os.WriteFile(filepath.Join(dir, "overlay-template.ext4"), []byte("already expanded"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "smolvm"), []byte("bin"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "notes.txt.zst"), []byte("unrelated"), 0o644))

	assert.Equal(t, []string{filepath.Join(dir, "storage-template.ext4.zst")}, templatesToWarm(dir))

	require.NoError(t, os.WriteFile(filepath.Join(dir, "storage-template.ext4"), []byte("expanded"), 0o644))
	assert.Empty(t, templatesToWarm(dir), "a pod whose templates are already expanded warms nothing")
}

// TEST_SCENARIO: a stop returns before its VMM does, and a start issued while that VMM still holds the disks is refused — which reads exactly like a machine that can never start, so the next attempt repeats it forever. The wait is what breaks that, and the machine that is genuinely stopped must not pay for it: both halves are asserted here, since a wait that always returned true would satisfy the second alone.
func TestAStartWaitsForTheVMMTheStopLeftBehind(t *testing.T) {
	proc := t.TempDir()
	dir := "/home/smolvm/.cache/smolvm/vms/abc123"
	require.NoError(t, os.MkdirAll(filepath.Join(proc, "100"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(proc, "100", "cmdline"),
		[]byte("/proc/self/exe\x00_boot-vm\x00"+dir+"/boot-config.json"), 0o644))

	started := time.Now()
	assert.False(t, vmmGone(proc, dir, 150*time.Millisecond), "a VMM still holding the disks was reported gone")
	assert.GreaterOrEqual(t, time.Since(started), 150*time.Millisecond, "the wait gave up before its limit")

	require.NoError(t, os.RemoveAll(filepath.Join(proc, "100")))
	started = time.Now()
	assert.True(t, vmmGone(proc, dir, 10*time.Second))
	assert.Less(t, time.Since(started), time.Second, "a stopped machine waited on a VMM that was already gone")
}

// TEST_SCENARIO: smolvm abandoned a machine's boot: of three processes only the one whose command line names that machine's vm dir is an orphan to kill.
func TestOrphanPIDsMatchOnlyTheMachinesVMDir(t *testing.T) {
	proc := t.TempDir()
	for pid, cmdline := range map[string]string{
		"100":  "/proc/self/exe\x00_boot-vm\x00/home/smolvm/.cache/smolvm/vms/abc123/boot-config.json",
		"101":  "/proc/self/exe\x00_boot-vm\x00/home/smolvm/.cache/smolvm/vms/abc1234/boot-config.json",
		"self": "vm-runner",
	} {
		require.NoError(t, os.MkdirAll(filepath.Join(proc, pid), 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(proc, pid, "cmdline"), []byte(cmdline), 0o644))
	}
	assert.Equal(t, []int{100}, orphanPIDs(proc, "/home/smolvm/.cache/smolvm/vms/abc123"))
	assert.Empty(t, orphanPIDs(proc, ""))
}

// TEST_SCENARIO: the controller re-sends a running machine's spec with a different image: the machine keeps the image it booted with, says so in its message, and the rest of the spec still applies.
func TestCreateOnlyDriftIsReportedAndDoesNotBlockTheRest(t *testing.T) {
	h := newHarness(t)
	desired := spec(true)
	_, err := h.client().Ensure(t.Context(), "m1", desired)
	require.NoError(t, err)
	h.settle(t, "m1")

	desired.Image = "quay.io/x/vm:2"
	desired.MemoryMiB = 4096
	_, err = h.client().Ensure(t.Context(), "m1", desired)
	require.NoError(t, err)
	st := h.settle(t, "m1")
	assert.Contains(t, st.Message, "fixed at create")
	assert.Contains(t, st.Message, "quay.io/x/vm:2")
	assert.Contains(t, h.calls(), "--mem 4096", "the mutable part of the spec is still applied")
	assert.Equal(t, 4096, st.MemoryMiB)
}

// TEST_SCENARIO: a machine smolvm still calls running has stopped answering long after it was last healthy: the runner stops and starts it rather than reporting the same dead machine forever, and counts that revival so the platform can tell it from a machine that was merely slow to start.
func TestADeadGuestIsActuallyRestarted(t *testing.T) {
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	assert.Zero(t, h.settle(t, "m1").Restarts)
	before := strings.Count(h.calls(), "machine start -n m1")

	h.node.mu.Lock()
	h.node.health["m1"] = health{everReady: true, quietSince: time.Now().Add(-unhealthyRestart - time.Minute)}
	h.node.mu.Unlock()

	st, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateRestarting, st.State)
	assert.False(t, st.Ready, "a machine on its way down is not a ready endpoint")
	assert.EqualValues(t, 1, h.settle(t, "m1").Restarts, "the revival is counted")
	assert.Greater(t, strings.Count(h.calls(), "machine start -n m1"), before, "the machine was restarted")
	assert.Contains(t, h.calls(), "machine stop -n m1")
}

// TEST_SCENARIO: a machine that never answered yet (a first boot flattening its image) and one that is mid-wake are both left alone; only a machine that answered before and then went quiet past the window is restarted.
func TestOnlyAPreviouslyHealthyMachineIsRestartedWhenItGoesQuiet(t *testing.T) {
	h := newHarness(t)
	h.node.health["m1"] = health{quietSince: time.Now().Add(-time.Hour)}
	assert.False(t, h.node.deadForLong("m1"), "a machine that never answered is still booting, not dead")

	h.node.health["m1"] = health{everReady: true, quietSince: time.Now().Add(-time.Hour)}
	assert.True(t, h.node.deadForLong("m1"))

	h.node.spawn("m1", StateStarting, func() error { return nil })
	assert.False(t, h.node.deadForLong("m1"), "a state change restarts the window")
}

// TEST_SCENARIO: the runner has room for one more machine, not two: the second is refused with a message naming what is committed, and it is refused before anything is spawned.
func TestAMachineIsRefusedWhenTheRunnerHasNoRoom(t *testing.T) {
	h := newHarness(t)
	h.node.MemoryMiB, h.node.ReserveMiB = 2048, 0
	small := spec(true)
	small.MemoryMiB = 2000
	_, err := h.client().Ensure(t.Context(), "m1", small)
	require.NoError(t, err)
	h.settle(t, "m1")

	second := spec(true)
	second.MemoryMiB = 1024
	st, err := h.client().Ensure(t.Context(), "m2", second)
	require.NoError(t, err)
	assert.Equal(t, ReasonOutOfCapacity, st.Reason)
	assert.Contains(t, st.Message, "does not fit")
	assert.NotContains(t, h.calls(), "machine create -n m2", "nothing is created for a machine that does not fit")
}

// TEST_SCENARIO: a caller puts a machine id that would climb out of the state directory; the id never reaches the filesystem, so no path outside the runner's own tree is touched.
func TestAMachineIDCannotEscapeTheStateDir(t *testing.T) {
	h := newHarness(t)
	assert.Error(t, h.node.ensure("../../escape", MachineSpec{MemoryMiB: 512}, false, false))
	_, err := h.node.machineDir("../../escape")
	assert.Error(t, err)

	dir, err := h.node.machineDir("agent-1")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(h.node.StateDir, "agent-1"), dir)
}

// TEST_SCENARIO: a caller puts an image reference carrying a dot segment or a newline; it is refused, so it can neither name an archive outside the runner's image directory nor forge a line in the runner's log.
func TestAnImageReferenceIsRefusedWhenItCouldEscapeAPathOrALogLine(t *testing.T) {
	h := newHarness(t)
	for _, image := range []string{"../../etc/passwd", "repo/../../etc/passwd", "repo/img:tag\nfake log line", "repo/img:tag with spaces"} {
		body := `{"running":true,"image":"` + strings.ReplaceAll(image, "\n", `\n`) + `","cpus":1,"memoryMiB":512,"storageGiB":5}`
		req, _ := http.NewRequest(http.MethodPut, h.srv.URL+"/machines/agent-1", bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer secret")
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, "image %q must be refused", image)
		resp.Body.Close()
	}
}

// TEST_SCENARIO: two machines are admitted at once and a third resizes upward; memory still committed by an operation that has not finished counts against the runner's limit, so concurrent creates cannot together overcommit it and a grow is gated like a create.
func TestCapacityCountsMachinesStillBeingCreated(t *testing.T) {
	h := newHarness(t)
	h.node.MemoryMiB, h.node.ReserveMiB = 2048, 0
	t.Setenv("FAKE_START_SLEEP", "0.5")

	first := spec(true)
	first.MemoryMiB = 1536
	_, err := h.client().Ensure(t.Context(), "m1", first)
	require.NoError(t, err)

	second := spec(true)
	second.MemoryMiB = 1024
	st, err := h.client().Ensure(t.Context(), "m2", second)
	require.NoError(t, err)
	assert.Equal(t, ReasonOutOfCapacity, st.Reason, "a machine still booting still holds its memory")
	assert.NotContains(t, h.calls(), "machine create -n m2")

	h.settle(t, "m1")
	grow := spec(true)
	grow.MemoryMiB = 4096
	st, err = h.client().Ensure(t.Context(), "m1", grow)
	require.NoError(t, err)
	assert.Equal(t, ReasonOutOfCapacity, st.Reason, "a resize past the limit is refused, not applied")
}

// TEST_SCENARIO: an agent is hibernated while its machine is still booting — the first boot takes minutes, so this is the common case, not a rare one. The stop must be honoured after the boot rather than dropped, or the machine runs on holding the runner's memory while the platform believes it is asleep.
func TestAStopIssuedWhileBootingIsHonoured(t *testing.T) {
	h := newHarness(t)
	c := h.client()
	t.Setenv("FAKE_START_SLEEP", "0.6")

	st, err := c.Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	require.Equal(t, StateCreating, st.State, "the machine is still coming up")

	stopped := spec(false)
	st, err = c.Ensure(t.Context(), "m1", stopped)
	require.NoError(t, err)
	assert.Equal(t, StateStopping, st.State, "the stop is planned, not dropped")

	h.settle(t, "m1")
	assert.Contains(t, h.calls(), "machine stop -n m1", "the machine is actually stopped once its boot finishes")
}

// TEST_SCENARIO: what the platform tells a user about a machine that would not start comes from matching smolvm's own error text, so the mapping is pinned here — a guest that never booted must not be reported as a missing image, and anything unrecognised has to land on the boot failure rather than invent a cause.
func TestFailureReasonsMatchWhatTheUserIsTold(t *testing.T) {
	for _, tc := range []struct {
		err  string
		want string
	}{
		{"cannot read archive /var/lib/platform/images/x.tar", ReasonImageUnavailable},
		{"unknown flag --image", ReasonImageUnavailable},
		{"failed to pull quay.io/x/y:1", ReasonImageUnavailable},
		{"no free machine port", ReasonOutOfCapacity},
		{"boot process exited with code 1", ReasonBootFailed},
		{"something smolvm has never said before", ReasonBootFailed},
	} {
		assert.Equal(t, tc.want, failureReason(errors.New(tc.err)), "error %q", tc.err)
	}

	unreadable := fmt.Errorf("%w: %w", errImageUnusable, errors.New("unexpected end of JSON input"))
	assert.Equal(t, ReasonImageUnavailable, failureReason(unreadable),
		"an image the runner cannot run is the image being unusable, not a guest that failed to boot — the words come from the runner here rather than from smolvm, so nothing in the text would say so")
}

// TEST_SCENARIO: the runner pod restarts — an OOM, a node drain, a chart roll — and its machines survive on the kept volume. Their published ports have to come back with the process, or every vm agent stays unreachable with a machine that looks perfectly healthy.
func TestARestartedRunnerRepublishesItsPorts(t *testing.T) {
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	st := h.settle(t, "m1")
	require.NotZero(t, st.Port)

	h.node.Close()
	restarted := &Server{
		Token: h.node.Token, StateDir: h.node.StateDir, ImageDir: h.node.ImageDir, Runtime: h.node.Runtime,
		PortMin: h.node.PortMin, PortMax: h.node.PortMax, MemoryMiB: h.node.MemoryMiB,
		Init: h.node.Init,
	}
	require.NoError(t, restarted.Start())
	t.Cleanup(restarted.Close)

	guest := fakeGuest(t, st.Port+loopbackOffset)
	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", st.Port))
	require.NoError(t, err, "the machine's port is listening again after the restart")
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 5)
	n, err := conn.Read(buf)
	require.NoError(t, err)
	assert.Equal(t, "hello", string(buf[:n]))
	assert.Equal(t, 1, guest(), "and it reaches the same guest, on the same port it had before")
}

// TEST_SCENARIO: a delete lands while work is still queued behind it; that work must not run, or it rebuilds a guest for an Agent that no longer exists and leaves it running with nothing left to collect it.
func TestWorkQueuedBeforeADeleteIsDropped(t *testing.T) {
	h := newHarness(t)
	ran := make(chan struct{}, 1)

	lock := h.node.lock("m1")
	lock.Lock()
	h.node.spawn("m1", StateCreating, func() error {
		ran <- struct{}{}
		return nil
	})

	h.node.mu.Lock()
	h.node.gens["m1"]++
	h.node.mu.Unlock()
	lock.Unlock()

	select {
	case <-ran:
		t.Fatal("work queued against a superseded generation ran anyway")
	case <-time.After(500 * time.Millisecond):
	}
}

// TEST_SCENARIO: a machine's egress allowlist is its gateway's ClusterIP, and Kubernetes reuses those. If the gateway is recreated on a different address, the running machine is still pinned to the old one — which the cluster may since have given to another owner's gateway — so it is stopped rather than left reachable there.
func TestAMachineIsStoppedWhenItsGatewayAddressChanges(t *testing.T) {
	h := newHarness(t)
	c := h.client()
	_, err := c.Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	h.settle(t, "m1")

	moved := spec(true)
	moved.AllowCIDRs = []string{"10.0.0.2/32"}
	_, err = c.Ensure(t.Context(), "m1", moved)
	require.NoError(t, err)
	st := h.settle(t, "m1")

	assert.Equal(t, ReasonEgressChanged, st.Reason)
	assert.Contains(t, st.Message, "recreate the agent")
	assert.Contains(t, h.calls(), "machine stop -n m1", "it is stopped, not left running on the old address")
	assert.NotContains(t, h.calls(), "--allow-cidr 10.0.0.2/32", "and never re-created with the new one behind the user's back")

	before := h.calls()
	st, err = c.Ensure(t.Context(), "m1", moved)
	require.NoError(t, err)
	assert.Equal(t, ReasonEgressChanged, st.Reason, "the reason holds across ticks")
	assert.Equal(t, StateStopped, st.State, "a bricked machine is left stopped, not planned to start again and reserving memory it will never use")
	assert.Equal(t, before, h.calls())
}

// TEST_SCENARIO: a machine may reach only its gateway, so the guest cannot fetch its own image — the runner does, once, onto a volume every runner shares. A second machine on the same image must find the unpacked tree already there and not fetch again.
func TestTheRunnerFetchesAnImageOnceForEveryMachineThatWantsIt(t *testing.T) {
	h := newHarness(t)
	fetches := filepath.Join(t.TempDir(), "fetches")
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(fetches)), 0o755))
	h.node.Crane = crane

	c := h.client()
	_, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-a")
	_, err = c.Ensure(t.Context(), "agent-b", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-b")

	pulled, err := os.ReadFile(fetches)
	require.NoError(t, err)
	assert.Equal(t, 1, strings.Count(string(pulled), "export "),
		"the second machine boots from the tree the first left behind: %s", pulled)
	assert.Equal(t, 1, strings.Count(string(pulled), "config "),
		"and its config was read once, with the tree, rather than per machine: %s", pulled)

	cached := filepath.Join(h.node.ImageDir, "quay.io_x_vm_1")
	unpacked, err := os.ReadFile(filepath.Join(cached, "rootfs", "hello"))
	require.NoError(t, err, "the tree every machine of this image shares")
	assert.Equal(t, "rootfs\n", string(unpacked))

	calls := h.calls()
	assert.Contains(t, calls, "-I "+filepath.Join(cached, "rootfs"), "smolvm is handed the shared tree")
	assert.Contains(t, calls, "-- /platform/init /entry serve",
		"and told what to run, which the tree does not say and without which the machine boots to nothing")
	assert.Contains(t, calls, "-w /app", "in the directory the image starts in")
	assert.Contains(t, calls, "-e PATH=/bin", "with the image's environment")
	assert.Contains(t, calls, "-e A=b",
		"and the platform's winning where the two collide, or the guest is the image's idea of a container rather than an agent")
	assert.NotContains(t, calls, "-e A=image", "which is what the image said")
}

// TEST_SCENARIO: every deploy adds an image under a fresh tag and nothing else prunes the shared volume, so without eviction it fills and then refuses every machine. The oldest archive goes first, and the one just fetched is never the victim.
func TestTheImageCacheEvictsTheOldestArchiveFirst(t *testing.T) {
	h := newHarness(t)
	dir := h.node.ImageDir
	require.NoError(t, os.MkdirAll(dir, 0o755))
	write := func(name string, age time.Duration) string {
		path := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(path, make([]byte, 1<<20), 0o644))
		at := time.Now().Add(-age)
		require.NoError(t, os.Chtimes(path, at, at))
		return path
	}
	stranger := filepath.Join(dir, "not-ours\nforged.tar")
	require.NoError(t, os.WriteFile(stranger, make([]byte, 1<<20), 0o644))
	require.NoError(t, os.Chtimes(stranger, time.Now().Add(-9*time.Hour), time.Now().Add(-9*time.Hour)))

	oldest := write("oldest.tar", 2*time.Hour)
	newer := write("newer.tar", time.Hour)
	keep := write("keep.tar", 0)

	h.node.evictImages(dir, keep, 2<<20+1<<19)

	_, oldestErr := os.Stat(oldest)
	_, newerErr := os.Stat(newer)
	_, keepErr := os.Stat(keep)
	assert.True(t, os.IsNotExist(oldestErr), "the oldest archive goes first, none of these being one a machine is running from")
	assert.NoError(t, newerErr, "the newer one stays while the budget allows it")
	assert.NoError(t, keepErr, "the archive just fetched is never the one evicted")
	_, strangerErr := os.Stat(stranger)
	assert.NoError(t, strangerErr, "a file this runner did not write is left alone, however old — the volume is shared, and its name never reaches a log line")
}

// TEST_SCENARIO: an operator's Secret reaches the guest on the smolvm command line, and a failed call carries that command's output into the Agent's status and the platform's logs. The value is removed whatever shape the tool prints it in — quoted, behind a different flag, or in a Go-style argument list — because matching the one shape I happened to imagine is not a defence.
func TestSecretValuesAreRedactedWhateverShapeTheyArePrintedIn(t *testing.T) {
	secret := "sk-live-abc123"
	for _, shape := range []string{
		"invocation: machine create -n m1 -e TOKEN=" + secret,
		"invocation: machine create -n m1 -e TOKEN='" + secret + " and more'",
		"invocation: machine create --env TOKEN=" + secret,
		`args: ["-e","TOKEN=` + secret + `"]`,
		"failed to set " + secret + " in the guest",
	} {
		got := redact(shape, []string{secret, "/home/agent"})
		assert.NotContains(t, got, secret, "shape %q", shape)
		assert.Contains(t, got, "***")
	}

	assert.Equal(t, "nothing to hide", redact("nothing to hide", nil), "output is untouched when there is no secret")
	assert.Equal(t, "a=1", redact("a=1", []string{"1"}), "a value too short to be a secret is left alone, so output stays readable")
}

// TEST_SCENARIO: an image is unpacked once and every machine of it boots that one tree, which is what the sharing is for — but a tree alone names no entrypoint, so what the image says to run is read with it and kept beside it. A tree left by the release that stored only files has no such record, and a machine booted from one starts and runs nothing; it is replaced rather than trusted. An archive an earlier release cached still boots, since smolvm reads the image out of it.
func TestATreeWithNoLaunchBesideItIsNotBootedFrom(t *testing.T) {
	h := newHarness(t)
	images := h.node.ImageDir
	tree := filepath.Join(images, "quay.io_x_vm_1")
	require.NoError(t, os.MkdirAll(filepath.Join(tree, "usr"), 0o755))

	fetches := filepath.Join(t.TempDir(), "fetches")
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(fetches)), 0o755))
	h.node.Crane = crane

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-a")
	assert.NotContains(t, h.calls(), "-I "+tree+" ",
		"a tree with no launch beside it names no entrypoint, so a machine booted from one would start and never run the harness")
	assert.FileExists(t, fetches, "so the image is fetched again rather than the bare tree being trusted")
	assert.Contains(t, h.calls(), "-I "+filepath.Join(tree, "rootfs"), "and the machine boots what that fetch wrote")

	legacy := filepath.Join(images, "quay.io_x_old_9.tar")
	require.NoError(t, os.WriteFile(legacy, []byte("tar"), 0o644))
	s := spec(true)
	s.Image = "quay.io/x/old:9"
	_, err = h.client().Ensure(t.Context(), "agent-b", s)
	require.NoError(t, err)
	h.settle(t, "agent-b")
	assert.Contains(t, h.calls(), "-I "+filepath.Join(images, "quay.io_x_old_9", "rootfs"),
		"an archive still on disk is upgraded rather than kept, or an install that already ran an image would never get the faster path for it")
}

// TEST_OVERVIEW: the shape `docker save` writes — layers, the image config, and a manifest naming which document is that config. The layer is larger than any config so the reader has something it must skip by size, and the manifest comes last, where docker puts it, so the config is only resolvable once the whole archive has been read.
func fakeArchive(t *testing.T, path string, config ...string) {
	t.Helper()
	var buf bytes.Buffer
	archive := tar.NewWriter(&buf)
	write := func(name, body string) {
		t.Helper()
		require.NoError(t, archive.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body))}))
		_, err := archive.Write([]byte(body))
		require.NoError(t, err)
	}
	image := `{"config":{"Entrypoint":["/entry"],"Cmd":["serve"],"Env":["A=image"],"WorkingDir":"/app"}}`
	if len(config) > 0 {
		image = config[0]
	}
	write("config.json", image)
	write("layer.tar", strings.Repeat("x", 2<<20))
	write("manifest.json", `[{"Config":"config.json","Layers":["layer.tar"]}]`)
	require.NoError(t, archive.Close())
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0o644))
}

// TEST_SCENARIO: upgrading an archive to a tree means fetching the image again, and a fetch can fail — a registry that is down, a tag that has been deleted, or an images volume mounted read-only, which is how the local cluster stages its archives. An archive already on disk would still have started that machine, so a failed upgrade falls back to it rather than failing the create. What the machine is told to run then comes from the archive itself: smolvm reads the layers out of one but not the config, so a machine handed the archive alone boots its filesystem and runs nothing at all.
func TestAFailedUpgradeStillBootsTheArchiveOnDisk(t *testing.T) {
	h := newHarness(t)
	broken := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(broken, []byte("#!/bin/sh\nexit 1\n"), 0o755))
	h.node.Crane = broken
	kept := filepath.Join(h.node.ImageDir, "quay.io_x_vm_1.tar")
	fakeArchive(t, kept)

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	st := h.settle(t, "agent-a")

	assert.Equal(t, StateRunning, st.State, "the create is not failed by an upgrade that could not be made")
	calls := h.calls()
	assert.Contains(t, calls, "-I "+kept,
		"and the archive on disk still starts the machine, which is the whole of what it is kept for")
	assert.Contains(t, calls, "-- /platform/init /entry serve",
		"with the entrypoint the archive names, or the guest comes up with no harness in it")
	assert.Contains(t, calls, "-w /app", "and the working directory the image asks for")
}

// TEST_SCENARIO: the entrypoint is what makes a machine more than a booted filesystem, so an archive that cannot yield one is refused at create — whether the config is missing altogether or names nothing to run. Failing here tells the user why, where booting anyway would leave a machine that starts, answers nothing, and says nothing about the reason.
func TestAnArchiveThatNamesNothingToRunFailsTheCreate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "image.tar")
	var buf bytes.Buffer
	archive := tar.NewWriter(&buf)
	body := `[{"Config":"config.json","Layers":["layer.tar"]}]`
	require.NoError(t, archive.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0o644, Size: int64(len(body))}))
	_, err := archive.Write([]byte(body))
	require.NoError(t, err)
	require.NoError(t, archive.Close())
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0o644))

	_, err = launchFromArchive(path)
	require.ErrorContains(t, err, "image config", "the refusal names what the archive could not give")

	fakeArchive(t, path, `{"config":{"Env":["A=image"],"WorkingDir":"/app"}}`)
	_, err = launchFromArchive(path)
	require.ErrorContains(t, err, "entrypoint",
		"an image that names nothing to run is refused too: a launch record that carries no command leaves the same guest with nothing in it")

	fakeArchive(t, path)
	launch, err := launchFromArchive(path)
	require.NoError(t, err)
	assert.Equal(t, []string{"/entry"}, launch.Entrypoint, "and a whole archive yields what the image says to run")
	assert.Equal(t, []string{"A=image"}, launch.Env, "with the environment it was built with")
}

// TEST_SCENARIO: a tool that fails per entry reports per entry, and for a whole image that reached megabytes when the runner still unpacked one itself. That output reaches the Agent as a condition message, and one over 32 KiB is refused by the API server — so the status write fails instead of the create, the reconcile never records the reason, and every retry fetches the image again. The cap belongs to the boundary rather than to whichever tool is behind it. What is kept is the head, because the first failure is the one the rest follow from.
func TestAFailingUnpackReportsLittleEnoughToBeStored(t *testing.T) {
	var flood strings.Builder
	for i := 0; flood.Len() < 3_000_000; i++ {
		fmt.Fprintf(&flood, "tar: usr/lib/entry-%d: Cannot mkdir: Permission denied\n", i)
	}
	kept := firstLines(flood.String())

	assert.Less(t, len(kept), 32768/2, "what is kept leaves room for the rest of a condition message")
	assert.Contains(t, kept, "usr/lib/entry-0:", "and it is the head, where the first failure is")
	assert.Contains(t, kept, "truncated", "and it says that it is not the whole story")
	assert.Equal(t, "boom", firstLines("  boom  "), "output that already fits is passed through, trimmed")
}

// UNIT_BOUNDARY_DESCRIPTION: a real crane answers two questions about an image and the runner asks both — what it says to run, and what its filesystem holds. A fake that answers only one would let a change that stopped asking the other pass.
func fakeCrane(log string) string {
	return "#!/bin/sh\n" +
		"echo \"$@\" >> " + log + "\n" +
		"if [ \"$1\" = config ]; then\n" +
		"  printf '{\"config\":{\"Entrypoint\":[\"/entry\"],\"Cmd\":[\"serve\"],\"Env\":[\"PATH=/bin\",\"A=image\"],\"WorkingDir\":\"/app\"}}'\n" +
		"  exit 0\n" +
		"fi\n" +
		"d=$(mktemp -d); echo rootfs > \"$d/hello\"; tar -cf - -C \"$d\" .\n"
}

// TEST_SCENARIO: an unpacked image is not a spare a machine consumes at create — it is the read-only lower layer every machine of that image keeps mounted for as long as it runs. Evicting one to make room therefore takes a running guest's filesystem away from it, and the machine does not fail at the moment of the deletion but the next time it reads a file it no longer has. The cache reads the machines' own stored specs to find which images are spoken for, and goes over its budget rather than free one of them.
func TestTheImageCacheNeverEvictsAnImageAMachineIsRunning(t *testing.T) {
	h := newHarness(t)
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(filepath.Join(t.TempDir(), "log"))), 0o755))
	h.node.Crane = crane

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.settle(t, "agent-a")

	dir := h.node.ImageDir
	booted := filepath.Join(dir, "quay.io_x_vm_1")
	require.DirExists(t, booted, "the tree agent-a is running from")
	old := time.Now().Add(-9 * time.Hour)
	require.NoError(t, os.Chtimes(booted, old, old))

	spare := filepath.Join(dir, "quay.io_x_other_2.tar")
	require.NoError(t, os.WriteFile(spare, make([]byte, 1<<20), 0o644))

	h.node.evictImages(dir, spare, 1)

	assert.DirExists(t, booted,
		"the oldest entry by far, and still the rootfs of a running machine — a full volume is the lesser harm")
	_, spareErr := os.Stat(spare)
	assert.NoError(t, spareErr, "and what was just fetched is never the one evicted either")
}

// TEST_SCENARIO: a runner restart takes its machines with it but not their specs, so the controller asks for each one again and the runner creates it afresh — with that machine's own spec already on disk naming the image it is about to unpack. The guard that keeps an in-use image from being replaced must not read that as somebody else's claim, or a runner would come back unable to recreate exactly the machines it just lost, and only for images whose cache entry predates the launch record.
func TestARestartedRunnerCanRecreateTheMachineThatOwnsTheImage(t *testing.T) {
	h := newHarness(t)
	crane := filepath.Join(t.TempDir(), "crane")
	require.NoError(t, os.WriteFile(crane, []byte(fakeCrane(filepath.Join(t.TempDir(), "log"))), 0o755))
	h.node.Crane = crane

	s := spec(true)
	require.NoError(t, os.MkdirAll(filepath.Join(h.node.StateDir, "agent-a"), 0o755))
	require.NoError(t, h.node.writeSpec("agent-a", s), "the spec a restart leaves behind")
	stale := filepath.Join(h.node.ImageDir, "quay.io_x_vm_1")
	require.NoError(t, os.MkdirAll(filepath.Join(stale, "usr"), 0o755), "and a tree from the release that stored no launch")

	_, err := h.client().Ensure(t.Context(), "agent-a", s)
	require.NoError(t, err)
	st := h.settle(t, "agent-a")

	assert.Equal(t, StateRunning, st.State,
		"the machine is recreated: its own spec is not another machine's claim on the image")
	assert.FileExists(t, filepath.Join(stale, launchFile),
		"and the tree it could not have booted is replaced by one that says what to run")
}

// TEST_SCENARIO: a create that is normally tens of milliseconds has been seen taking twenty seconds, and only when the platform is the one asking — by hand it does not reproduce, so nothing can be learned after the fact. smolvm accounts for its own boot in phases, so a slow operation keeps that account in the runner's log where an operator will find it. A normal operation keeps nothing: the same text on every call would bury the one worth reading. The output is redacted like a failure's, because an operator's Secret reaches a guest on that command line.
func TestASlowMachineOperationKeepsTheRuntimesAccountOfIt(t *testing.T) {
	var logged bytes.Buffer
	restore := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logged, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(restore) })

	dir := t.TempDir()
	slow := filepath.Join(dir, "slow")
	require.NoError(t, os.WriteFile(slow,
		[]byte("#!/bin/sh\nsleep 2.2\necho 'boot: disks ready elapsed_ms=19000'\necho 'seen s3cret-token'\n"), 0o755))
	require.NoError(t, (&Smolvm{Bin: slow}).run([]string{"s3cret-token"}, "machine", "start", "-n", "agent-a"))

	assert.Contains(t, logged.String(), "boot: disks ready",
		"the runtime's own phase timings are what make an unreproducible stall readable")
	assert.NotContains(t, logged.String(), "s3cret-token", "and a Secret on that command line is not published to reach them")

	logged.Reset()
	quick := filepath.Join(dir, "quick")
	require.NoError(t, os.WriteFile(quick, []byte("#!/bin/sh\necho 'boot: disks ready elapsed_ms=19'\n"), 0o755))
	require.NoError(t, (&Smolvm{Bin: quick}).run(nil, "machine", "start", "-n", "agent-b"))
	assert.NotContains(t, logged.String(), "boot: disks ready",
		"an operation that was not slow keeps nothing, or the slow one is lost among them")
}

// UNIT_BOUNDARY_DESCRIPTION: a runner backed by its own state directory and whichever image directory the test is about, which is the whole of what the cache logic reads.
func cacheRunner(t *testing.T, id, images string) *Server {
	t.Helper()
	return &Server{StateDir: t.TempDir(), ImageDir: images, RunnerID: id}
}

// UNIT_BOUNDARY_DESCRIPTION: gives a runner a machine running from an image, and the cached tree that machine has mounted.
func holdsImage(t *testing.T, s *Server, machine, image string) string {
	t.Helper()
	dir, err := s.machineDir(machine)
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, s.writeSpec(machine, MachineSpec{Image: image}))
	cached := s.cachePath(image)
	require.NoError(t, os.MkdirAll(cached, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(cached, "rootfs"), make([]byte, 4096), 0o644))
	return cached
}

// TEST_SCENARIO: two owners' runners land on one node and share its image cache. A runner reads only its own machines — they are its child processes — so evicting on that alone would delete the tree another runner's guest has mounted as its root filesystem, which is the one thing eviction must never do. Each publishes what it holds, and the other reads it.
func TestEvictionSparesAnImageAnotherRunnerHolds(t *testing.T) {
	images := t.TempDir()
	mine, theirs := cacheRunner(t, "runner-a", images), cacheRunner(t, "runner-b", images)

	held := holdsImage(t, theirs, "agent-b", "quay.io/x/held:1")
	theirs.publishHolders()
	spare := holdsImage(t, mine, "agent-a", "quay.io/x/mine:1")

	mine.evictImages(images, spare, 1)

	assert.DirExists(t, held, "another runner's machine is running from this tree")
	assert.DirExists(t, spare, "and this runner's own machine from this one")
}

// TEST_SCENARIO: a runner publishes every machine whose spec it holds, the one being recreated included — it cannot know which of them a later create will be for. claim() has to make that exception, because a restarted runner recreates the machines it still holds specs for, and the tree it finds may be a launch-less one from an older release. Reading its own published claim as somebody else's would refuse that image forever, telling the operator to stop the very machine they are starting, on the one path that can replace such a tree.
func TestARunnersOwnClaimNeverBlocksTheMachineItIsRecreating(t *testing.T) {
	images := t.TempDir()
	staged := func(name string) string {
		dir := filepath.Join(t.TempDir(), name)
		require.NoError(t, os.MkdirAll(dir, 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(dir, launchFile), []byte(`{"entrypoint":["/bin/sh"]}`), 0o644))
		return dir
	}

	mine := cacheRunner(t, "runner-a", images)
	cached := holdsImage(t, mine, "agent-a", "quay.io/x/mine:1")
	mine.publishHolders()

	require.NoError(t, mine.claim(staged("incoming"), cached, "agent-a"),
		"this runner's own published claim names the machine being recreated, and must not stand in its way")
	assert.FileExists(t, filepath.Join(cached, launchFile),
		"the launch-less tree is replaced, which nothing else does")

	theirs := cacheRunner(t, "runner-b", images)
	holdsImage(t, theirs, "agent-b", "quay.io/x/mine:1")
	theirs.publishHolders()
	require.NoError(t, os.Remove(filepath.Join(cached, launchFile)))

	require.Error(t, mine.claim(staged("incoming-again"), cached, "agent-a"),
		"another runner's guest has this tree mounted as its root filesystem, and that claim still holds")
}

// TEST_SCENARIO: nothing else prunes the node's cache, so an image no live runner claims has to be evictable — otherwise one abandoned holders file pins a tree forever. Machines are processes of the runner that made them, so a runner that stopped refreshing has none left running and its claims are safe to drop.
func TestAnAbandonedRunnersClaimsStopPinningImages(t *testing.T) {
	images := t.TempDir()
	mine, gone := cacheRunner(t, "runner-a", images), cacheRunner(t, "runner-gone", images)

	stranded := holdsImage(t, gone, "agent-gone", "quay.io/x/stranded:1")
	gone.publishHolders()
	marker := filepath.Join(images, holdersDir, "runner-gone")
	stale := time.Now().Add(-holderStale - time.Minute)
	require.NoError(t, os.Chtimes(marker, stale, stale))

	keep := holdsImage(t, mine, "agent-a", "quay.io/x/mine:1")
	mine.evictImages(images, keep, 1)

	assert.NoDirExists(t, stranded, "no live runner claims it")
	assert.NoFileExists(t, marker, "and the claim itself goes, rather than being re-read every eviction")
}

// TEST_SCENARIO: one number bounds the cache wherever it lives. There is no share-of-the-filesystem fallback to be had: a node's filesystem is shared with everything else the node runs, and the runner's own claim is shared with the machine disks, so either share would let the images evict their way into space that is not theirs.
func TestTheCacheIsBoundedByItsBudgetAndNothingElse(t *testing.T) {
	images := t.TempDir()
	s := cacheRunner(t, "runner-a", images)
	s.ImageBudget = 6000

	keep := holdsImage(t, s, "agent-a", "quay.io/x/mine:1")
	stale := holdsImage(t, cacheRunner(t, "runner-b", images), "agent-b", "quay.io/x/cold:1")
	older := time.Now().Add(-time.Hour)
	require.NoError(t, os.Chtimes(stale, older, older))

	s.evictImages(images, keep, s.ImageBudget)

	assert.DirExists(t, keep, "this runner's own machine is running from it")
	assert.NoDirExists(t, stale, "nothing claims this one and the budget is spent")
}

// TEST_SCENARIO: a machine operation runs on its own goroutine and writes to the state and image directories for as long as it takes — a fetch may be unpacking an image when the runner is told to stop. Close used to drop the published ports and return while all of that was still running, which hands the caller a runner it believes is finished with and is not: the directories keep changing, and a caller that removes them, as every test does, removes them out from under a live fetch. So Close waits, and a start still sleeping when it is called has finished by the time it returns.
func TestCloseWaitsForTheOperationsStillRunning(t *testing.T) {
	t.Setenv("FAKE_START_SLEEP", "1")
	h := newHarness(t)

	st, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	require.Equal(t, StateCreating, st.State, "the start is still running, which is what makes this a wait and not a no-op")

	h.node.Close()

	state, err := os.ReadFile(filepath.Join(h.state, "agent-a"))
	require.NoError(t, err, "the fake runtime records what it did, and it is still inside the temporary directory")
	assert.Equal(t, "running\n", string(state), "Close returned before the start it was waiting for had finished")
}

// TEST_SCENARIO: once the runner is closing, a machine operation started anyway would outlive the wait that was supposed to cover it — the whole point of which is that nothing is still writing when Close returns. So a request that arrives after Close starts no work.
func TestNoOperationStartsAfterClose(t *testing.T) {
	h := newHarness(t)
	h.node.Close()

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)

	// UNIT_BOUNDARY_DESCRIPTION: closing again waits for anything the request did start, so the check below is not merely reading the directory before a goroutine got to it.
	h.node.Close()

	_, err = os.Stat(filepath.Join(h.state, "agent-a"))
	assert.True(t, os.IsNotExist(err), "a machine was created by an operation that started after the runner closed")
}

// TEST_SCENARIO: the harness used to prove its ports free and then let them go, leaving the runner to bind them again later — so anything on the host could take one in between, and a machine then failed to publish for a reason that had nothing to do with the test. The reservation is held instead and handed over, so there is no moment in which the port is free: this asserts the port cannot be taken while the harness holds it, and that the machine still publishes on exactly that port.
func TestThePublishedPortIsNeverUnboundBeforeTheRunnerTakesIt(t *testing.T) {
	h := newHarness(t)

	blocked, err := net.Listen("tcp", fmt.Sprintf(":%d", h.node.PortMin))
	if err == nil {
		blocked.Close()
		t.Fatalf("port %d was free before the runner published on it, so the harness released it", h.node.PortMin)
	}

	st, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	st = h.settle(t, "agent-a")
	require.Equal(t, StateRunning, st.State, "the runner published on the port the harness was holding for it")
	assert.Equal(t, h.node.PortMin, st.Port)
}

// TEST_SCENARIO: the published ports are bound on every interface, as the runner binds them, and the guest ports only on loopback, as the fake guest binds them. A base whose guest ports fall inside another harness's published range would hand two harnesses the same port under different names, so the bases are drawn from a window narrow enough that the two ranges cannot meet.
func TestAHarnessGuestPortsCannotBeAnotherHarnessPublishedPorts(t *testing.T) {
	for range 50 {
		base := freePort(t)
		assert.Less(t, base+portsPerHarness-1, firstBase+loopbackOffset,
			"published ports must stay inside the first loopbackOffset of the range")
		assert.GreaterOrEqual(t, base+loopbackOffset, firstBase+loopbackOffset,
			"and the guest ports must fall outside it, where no base can reach them")
	}
}

// TEST_SCENARIO: a request reserves the machine's memory before the operation is started, and the reservation is released by the very goroutine a closing runner refuses to start. Left behind it is a claim on memory for a machine that does not exist, which the next admission decision counts against every machine that does. Nothing reached this before the runner answered a signal; now that closing is something that happens on purpose, the refusal has to undo what the request had already put down.
func TestARefusedOperationLeavesNoMemoryReserved(t *testing.T) {
	h := newHarness(t)
	h.node.Close()

	_, err := h.client().Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)

	h.node.mu.Lock()
	defer h.node.mu.Unlock()
	assert.Empty(t, h.node.committing,
		"the runner is still holding memory for a machine whose start it refused")
}
