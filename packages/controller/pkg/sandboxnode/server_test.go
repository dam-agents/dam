// TEST_OVERVIEW: the sandbox node turns the controller's desired machine (shape + power state) into smolvm CLI calls and reports the machine back. What must hold: a bearer token gates every call; an absent machine that should run is created with its published port, CA mount, egress allowlist and env, then started; a stopped one is re-shaped and started; a running one that should stop is stopped; delete removes the machine and frees its port; the published port is stable for the machine's life and unique on the node.
package sandboxnode

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
  start) echo running > "$FAKE_STATE/$4" ;;
  stop) echo stopped > "$FAKE_STATE/$4" ;;
  delete) rm -f "$FAKE_STATE/$4" ;;
esac
`

type harness struct {
	srv   *httptest.Server
	log   string
	state string
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
	s := &Server{Token: "secret", StateDir: filepath.Join(dir, "machines"), Smolvm: bin, PortMin: 31000, PortMax: 31001}
	h.srv = httptest.NewServer(s.Handler())
	t.Cleanup(h.srv.Close)
	t.Cleanup(s.Close)
	return h
}

func (h *harness) calls() string {
	b, _ := os.ReadFile(h.log)
	return string(b)
}

func (h *harness) waitIdle(t *testing.T, c *Client, id string) MachineStatus {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		st, err := c.Status(t.Context(), id)
		require.NoError(t, err)
		if st.State != StateCreating && st.State != StateStarting && st.State != StateStopping {
			return st
		}
		require.True(t, time.Now().Before(deadline), "operation never finished: %+v", st)
		time.Sleep(10 * time.Millisecond)
	}
}

func spec(running bool) MachineSpec {
	return MachineSpec{Image: "quay.io/x/vm:1", CPUs: 2, MemoryMiB: 2048, StorageGiB: 5, Running: running,
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

// TEST_SCENARIO: a vm agent waking for the first time: the machine is created with everything the guest needs to reach only its gateway, then started; the same request again is a no-op that reports the running machine and its port.
func TestCreatesAndStartsAnAbsentMachine(t *testing.T) {
	h := newHarness(t)
	c := NewClient(h.srv.URL, "secret")

	st, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateCreating, st.State)

	st = h.waitIdle(t, c, "agent-a")
	assert.Equal(t, StateRunning, st.State)
	assert.Equal(t, 31000, st.Port)
	assert.False(t, st.Ready, "nothing listens on the guest side in this test")

	calls := h.calls()
	assert.Contains(t, calls, "machine create -n agent-a -I quay.io/x/vm:1")
	assert.Contains(t, calls, "--cpus 2 --mem 2048 --storage 5 -u root --net -p 32000:8080")
	assert.Contains(t, calls, "/agent-a/ca:/etc/platform/ca:ro --allow-cidr 10.0.0.1/32 -e A=b -e HTTPS_PROXY=http://10.0.0.1:10000")
	assert.Contains(t, calls, "machine start -n agent-a")
	ca, err := os.ReadFile(filepath.Join(filepath.Dir(h.state), "machines", "agent-a", "ca", "ca.crt"))
	require.NoError(t, err)
	assert.Equal(t, "PEM", string(ca))

	before := h.calls()
	st, err = c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	assert.Equal(t, StateRunning, st.State)
	assert.Equal(t, before, h.calls()[:len(before)])
	assert.NotContains(t, h.calls()[len(before):], "create")
}

// TEST_SCENARIO: hibernate then wake: stopping keeps the machine and its port; the wake re-applies the shape (a template may have changed cpus, memory or env) before starting.
func TestStopsAndRestartsKeepingThePort(t *testing.T) {
	h := newHarness(t)
	c := NewClient(h.srv.URL, "secret")
	_, err := c.Ensure(t.Context(), "agent-a", spec(true))
	require.NoError(t, err)
	h.waitIdle(t, c, "agent-a")

	st, err := c.Ensure(t.Context(), "agent-a", spec(false))
	require.NoError(t, err)
	assert.Equal(t, StateStopping, st.State)
	st = h.waitIdle(t, c, "agent-a")
	assert.Equal(t, StateStopped, st.State)
	assert.Equal(t, 31000, st.Port)

	bigger := spec(true)
	bigger.CPUs = 4
	_, err = c.Ensure(t.Context(), "agent-a", bigger)
	require.NoError(t, err)
	st = h.waitIdle(t, c, "agent-a")
	assert.Equal(t, StateRunning, st.State)
	assert.Equal(t, 31000, st.Port)
	assert.Contains(t, h.calls(), "machine update -n agent-a --cpus 4 --mem 2048 -e A=b")

	_, err = c.Ensure(t.Context(), "agent-b", spec(false))
	require.NoError(t, err)
	assert.NotContains(t, h.calls(), "create -n agent-b", "a machine that should not run is never created")
}

// TEST_SCENARIO: ports are the node's scarce resource: two machines never share one, and deleting a machine gives its port back.
func TestPortsAreUniqueAndReleasedOnDelete(t *testing.T) {
	h := newHarness(t)
	c := NewClient(h.srv.URL, "secret")
	for _, id := range []string{"agent-a", "agent-b"} {
		_, err := c.Ensure(t.Context(), id, spec(true))
		require.NoError(t, err)
		h.waitIdle(t, c, id)
	}
	assert.Equal(t, 31001, h.waitIdle(t, c, "agent-b").Port)

	_, err := c.Ensure(t.Context(), "agent-c", spec(true))
	require.NoError(t, err)
	st := h.waitIdle(t, c, "agent-c")
	assert.Equal(t, StateAbsent, st.State)
	assert.Contains(t, st.Message, "no free machine port")

	require.NoError(t, c.Delete(t.Context(), "agent-a"))
	assert.Contains(t, h.calls(), "machine delete -n agent-a -f")
	st, err = c.Status(t.Context(), "agent-a")
	require.NoError(t, err)
	assert.Equal(t, StateAbsent, st.State)

	_, err = c.Ensure(t.Context(), "agent-c", spec(true))
	require.NoError(t, err)
	assert.Equal(t, 31000, h.waitIdle(t, c, "agent-c").Port)
}

// TEST_SCENARIO: a locally built image has no registry; when the node holds a docker-save archive named after the reference, the machine is created from that archive instead of pulling.
func TestUsesLocalArchiveWhenPresent(t *testing.T) {
	h := newHarness(t)
	c := NewClient(h.srv.URL, "secret")
	archive := filepath.Join(filepath.Dir(h.state), "machines", "images", "platform-claude-code-vm_latest.tar")
	require.NoError(t, os.MkdirAll(filepath.Dir(archive), 0o755))
	require.NoError(t, os.WriteFile(archive, []byte("tar"), 0o644))

	s := spec(true)
	s.Image = "platform-claude-code-vm:latest"
	_, err := c.Ensure(t.Context(), "agent-a", s)
	require.NoError(t, err)
	h.waitIdle(t, c, "agent-a")
	assert.Contains(t, h.calls(), "-I "+archive)
	var body bytes.Buffer
	require.NoError(t, json.NewEncoder(&body).Encode(s))
	assert.True(t, strings.Contains(h.calls(), "--max-image-size 16GiB"))
}
