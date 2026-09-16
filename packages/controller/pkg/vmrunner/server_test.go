// TEST_OVERVIEW: the VM runner turns the controller's desired machine (shape + power state) into smolvm CLI calls and reports the machine back. What must hold: a bearer token gates every call; an absent machine that should run is created with its published port, CA mount, egress allowlist and env, then started; a stopped one is re-shaped in place and started; a running one that should stop is stopped; a change of size, env, CA or restart revision restarts the machine (stop, update, start) without recreating it; a machine that was healthy and then stops answering is stopped and started again, but only after a window no legitimate boot reaches, and every state change restarts that window so a slow wake is never cut short; the image and egress allow-list are fixed at create, so a change to either is reported and the rest of the spec still applies; a start first recovers whatever an unclean stop left (smolvm reports such a machine unreachable, and its root overlay — throwaway by contract, only the storage disk persists — can come back dirty and make the boot exit at once, in which case it is discarded and the start retried; a clean overlay is kept because recreating one costs most of smolvm's ready window) and leaves no guest process behind when smolvm gives up on it; delete waits for the in-flight operation, removes the machine and frees its port; ports are unique on the node; only allowed sources may dial a published port; a machine is admitted only when the runner has the memory for it, and a guest the runner had to restart is counted so the platform can tell a reboot from a slow start.
package vmrunner

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
  stop) echo stopped > "$FAKE_STATE/$4" ;;
  delete) rm -f "$FAKE_STATE/$4" ;;
esac
`

type harness struct {
	srv   *httptest.Server
	node  *Server
	log   string
	state string
}

// TEST_OVERVIEW: the harness binds real ports, so it takes a pair the kernel says are free rather than the fixed range a second suite run — or the NodePort range the runner's own policy opens — would already be holding.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := ln.Addr().(*net.TCPAddr).Port
	require.NoError(t, ln.Close())
	return port
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
	h := &harness{log: filepath.Join(dir, "log"), state: filepath.Join(dir, "state")}
	require.NoError(t, os.MkdirAll(h.state, 0o755))
	t.Setenv("FAKE_LOG", h.log)
	t.Setenv("FAKE_STATE", h.state)
	first := freePort(t)
	h.node = &Server{
		Token: "secret", StateDir: filepath.Join(dir, "machines"), Runtime: &Smolvm{Bin: bin},
		PortMin: first, PortMax: first + 1, MemoryMiB: 1 << 20,
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
	assert.Contains(t, calls, "machine create -n agent-a -I quay.io/x/vm:1")
	assert.Contains(t, calls, fmt.Sprintf("--cpus 2 --mem 2048 --storage 5 -u root --net --net-backend virtio-net -p %d:8080", h.node.PortMin+loopbackOffset))
	assert.Contains(t, calls, "/agent-a/ca:/etc/platform/ca:ro --allow-cidr 10.0.0.1/32 -e A=b -e HTTPS_PROXY=http://10.0.0.1:10000")
	assert.Contains(t, calls, "machine start -n agent-a")
	ca, err := os.ReadFile(filepath.Join(h.node.StateDir, "machines", "agent-a", "ca", "ca.crt"))
	require.NoError(t, err)
	assert.Equal(t, "PEM", string(ca))

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
	time.Sleep(50 * time.Millisecond)
	require.NoError(t, c.Delete(t.Context(), "agent-c"))
	assert.True(t, strings.HasSuffix(h.calls(), "machine start -n agent-c\nmachine delete -n agent-c -f\n"), h.calls())
}

// TEST_SCENARIO: the published port is the guest's only inbound path; with an allow-list only those sources get through, everyone else is dropped at accept. A locally loaded archive named after the reference beats a registry pull, so a dev cluster never needs a registry.
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

	archive := filepath.Join(h.node.StateDir, "images", "platform-claude-code-vm_latest.tar")
	require.NoError(t, os.MkdirAll(filepath.Dir(archive), 0o755))
	require.NoError(t, os.WriteFile(archive, []byte("tar"), 0o644))
	s := spec(true)
	s.Image = "platform-claude-code-vm:latest"
	_, err = h.client().Ensure(t.Context(), "agent-b", s)
	require.NoError(t, err)
	h.settle(t, "agent-b")
	assert.Contains(t, h.calls(), "-I "+archive)
}

// TEST_SCENARIO: a machine directory holds the sockets and lock of a guest that died with the last pod: starting the machine stops it for recovery and removes them, keeping the storage disk and the root overlay, before smolvm boots it; when that boot dies at once the overlay is discarded and the start retried.
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

func TestStartRecoversAnUncleanlyStoppedMachine(t *testing.T) {
	h := newHarness(t)
	t.Setenv("HOME", t.TempDir())
	dir := filepath.Join(os.Getenv("HOME"), ".cache", "smolvm", "vms", "vm1")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "name"), []byte("m1\n"), 0o644))
	for _, f := range []string{"agent.ready", "vm.lock", "overlay.qcow2", "storage.raw"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, f), nil, 0o644))
	}
	require.NoError(t, os.WriteFile(filepath.Join(h.state, "m1"), []byte("stopped"), 0o644))
	require.NoError(t, h.node.Runtime.Start("m1"))
	for _, f := range []string{"agent.ready", "vm.lock"} {
		assert.NoFileExists(t, filepath.Join(dir, f))
	}
	assert.FileExists(t, filepath.Join(dir, "storage.raw"))
	assert.FileExists(t, filepath.Join(dir, "overlay.qcow2"))
	log, _ := os.ReadFile(h.log)
	assert.Contains(t, string(log), "machine stop -n m1\nmachine start -n m1")

	t.Setenv("FAKE_START_FAIL_ONCE", "boot process exited (code 1) before the agent was ready")
	require.NoError(t, os.WriteFile(filepath.Join(h.state, "m1"), []byte("stopped"), 0o644))
	require.NoError(t, h.node.Runtime.Start("m1"))
	assert.NoFileExists(t, filepath.Join(dir, "overlay.qcow2"))
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
	assert.Equal(t, filepath.Join(h.node.StateDir, "machines", "agent-1"), dir)
}

// TEST_SCENARIO: a caller puts an image reference carrying a dot segment or a newline; it is refused, so it can neither name an archive outside the runner's image directory nor forge a line in the runner's log.
func TestAnImageReferenceIsRefusedWhenItCouldEscapeAPathOrALogLine(t *testing.T) {
	h := newHarness(t)
	for _, image := range []string{"../../etc/passwd", "repo/img:tag\nfake log line", "repo/img:tag with spaces"} {
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
		{"cannot read archive /var/lib/vm-runner/images/x.tar", ReasonImageUnavailable},
		{"unknown flag --image", ReasonImageUnavailable},
		{"failed to pull quay.io/x/y:1", ReasonImageUnavailable},
		{"no free machine port", ReasonOutOfCapacity},
		{"boot process exited with code 1", ReasonBootFailed},
		{"something smolvm has never said before", ReasonBootFailed},
	} {
		assert.Equal(t, tc.want, failureReason(errors.New(tc.err)), "error %q", tc.err)
	}
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
		Token: h.node.Token, StateDir: h.node.StateDir, Runtime: h.node.Runtime,
		PortMin: h.node.PortMin, PortMax: h.node.PortMax, MemoryMiB: h.node.MemoryMiB,
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
