// UNIT_BOUNDARY_DESCRIPTION: the machine API as a contract any runner has to honour, checked from the outside. The controller drives a runner only through PUT, GET and DELETE on /machines/{id} and GET /machines, so a runner that answers these the same way can take the place of another — a different VMM behind the same runner, or a runner written in another language. Every case talks to the runner through the controller's own client and boots the probe guest, so what it asserts is what the controller would see: nothing here reads a runner's files or its logs.
package vmconformance

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/dam-agents/dam/packages/controller/pkg/vmprobe"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	egressBefore = "192.0.2.1/32"
	egressAfter  = "192.0.2.2/32"
	// UNIT_BOUNDARY_DESCRIPTION: far past the memory of any host a runner is given, so a runner that admits machines against its memory at all has to refuse this one.
	tooMuchMiB = 1 << 26
	poll       = 200 * time.Millisecond
)

type Target struct {
	Client *vmrunner.Client
	// UNIT_BOUNDARY_DESCRIPTION: an image whose entrypoint is the probe guest. The suite reads a machine's disk only through what that guest answers.
	Image     string
	MemoryMiB int
	// UNIT_BOUNDARY_DESCRIPTION: how long one boot may take on this runner. A fake VMM answers in milliseconds, while a real one may be unpacking the image for the first time.
	Ready time.Duration
	// UNIT_BOUNDARY_DESCRIPTION: restarts the runner and returns once it has been asked to. Nil skips the restart case, since only whoever deployed the runner knows how to restart it.
	Restart func(t *testing.T)
	// UNIT_BOUNDARY_DESCRIPTION: the address a machine's published port is reachable at from this process. Nil means it is not reachable from here, and the cases that would dial it check only what the machine API reports.
	Published func(port int) string
}

func Run(t *testing.T, target Target) {
	if target.MemoryMiB == 0 {
		target.MemoryMiB = 512
	}
	if target.Ready == 0 {
		target.Ready = 10 * time.Minute
	}
	require.NotNil(t, target.Client, "a conformance run needs a client for the runner")
	require.NotEmpty(t, target.Image, "a conformance run needs an image that boots the probe guest")

	// TEST_SCENARIO: an agent's first wake. An absent machine asked to run is created and reported as not ready yet; it then becomes ready on a published port with the size it was given, is listed, and asking again for the same spec changes nothing — the start the runner already made is not made again.
	t.Run("create reaches ready", func(t *testing.T) {
		m := newMachine(t, target)
		st := m.ensure(t, m.spec())
		assert.False(t, st.Ready, "a machine that did not exist cannot be ready in the answer that creates it")
		st = m.waitReady(t)
		assert.Equal(t, vmrunner.StateRunning, st.State)
		assert.NotZero(t, st.Port, "a running machine is published on a port")
		assert.Equal(t, 1, st.CPUs)
		assert.Equal(t, target.MemoryMiB, st.MemoryMiB)
		assert.Contains(t, m.list(t), m.id)
		m.dialHealthy(t, st.Port)

		again := m.ensure(t, m.spec())
		assert.Equal(t, vmrunner.StateRunning, again.State, "the same spec again is not a new operation")
		assert.Equal(t, st.Port, again.Port)
		assert.Zero(t, again.StartingMs, "a machine that answered is no longer starting")
	})

	// TEST_SCENARIO: hibernate and wake. A machine asked to stop stops and keeps its port; asked to run again, it starts with what its disk held — the probe guest is ready only if the marker its first boot wrote is still there.
	t.Run("stop and start keep the disk", func(t *testing.T) {
		m := newMachine(t, target)
		first := m.spec()
		first.Env = map[string]string{vmprobe.EnvWrite: m.marker}
		m.ensure(t, first)
		running := m.waitReady(t)

		stopped := first
		stopped.Running = false
		m.ensure(t, stopped)
		st := m.waitState(t, vmrunner.StateStopped)
		assert.False(t, st.Ready, "a stopped machine is not ready")
		assert.Equal(t, running.Port, st.Port, "a stopped machine keeps its port")

		wake := m.spec()
		wake.Env = map[string]string{vmprobe.EnvExpect: m.marker}
		m.ensure(t, wake)
		st = m.waitReady(t)
		assert.Equal(t, running.Port, st.Port)
	})

	// TEST_SCENARIO: the restart verb rolls the Agent's revision. The machine is restarted in place: it answers the ensure as restarting, starts again, becomes ready, and stays on its port.
	t.Run("a revision change restarts the machine", func(t *testing.T) {
		m := newMachine(t, target)
		m.ensure(t, m.spec())
		before := m.waitReady(t)
		bootBefore := m.boot(t, before.Port)

		rolled := m.spec()
		rolled.Revision = "r2"
		asked := time.Now()
		st := m.ensure(t, rolled)
		assert.Equal(t, vmrunner.StateRestarting, st.State)
		after := m.waitReady(t)
		assert.Equal(t, before.Port, after.Port, "a restart keeps the machine's port")
		assert.LessOrEqual(t, after.StartingMs, time.Since(asked).Milliseconds(), "the machine was not started again after the revision changed")
		if bootBefore != "" {
			assert.NotEqual(t, bootBefore, m.boot(t, after.Port), "the guest answering is the one from before the restart")
		}
	})

	// TEST_SCENARIO: the egress allowlist is the gateway's address, and that address can move to another owner's gateway. A running machine whose allowlist changes is stopped and refused with the egress reason, and it stays stopped on every later ensure rather than being started against an address it no longer owns.
	t.Run("an egress change is refused", func(t *testing.T) {
		m := newMachine(t, target)
		m.ensure(t, m.spec())
		m.waitReady(t)

		moved := m.spec()
		moved.AllowCIDRs = []string{egressAfter}
		m.ensure(t, moved)
		m.waitReason(t, vmrunner.ReasonEgressChanged)
		st := m.waitState(t, vmrunner.StateStopped)
		assert.False(t, st.Ready)

		again := m.ensure(t, moved)
		assert.Equal(t, vmrunner.ReasonEgressChanged, again.Reason, "the refusal holds on the next ensure")
		assert.Equal(t, vmrunner.StateStopped, again.State, "a refused machine is not started again")
	})

	// TEST_SCENARIO: a machine that does not fit the runner's memory is refused with the capacity reason and a message, and nothing is created for it.
	t.Run("a machine that does not fit is refused", func(t *testing.T) {
		m := newMachine(t, target)
		huge := m.spec()
		huge.MemoryMiB = tooMuchMiB
		m.ensure(t, huge)
		st := m.waitReason(t, vmrunner.ReasonOutOfCapacity)
		assert.NotEmpty(t, st.Message, "a refusal says what did not fit")
		assert.Equal(t, vmrunner.StateAbsent, st.State, "nothing is created for a machine that does not fit")
		assert.NotContains(t, m.list(t), m.id)
	})

	// TEST_SCENARIO: a deleted Agent's machine is gone, with its disk. It is reported absent with no port and is no longer listed; a second delete succeeds; and a machine created again under the same id starts from an empty disk.
	t.Run("delete removes the machine's state", func(t *testing.T) {
		m := newMachine(t, target)
		first := m.spec()
		first.Env = map[string]string{vmprobe.EnvWrite: m.marker}
		m.ensure(t, first)
		m.waitReady(t)

		require.NoError(t, target.Client.Delete(t.Context(), m.id))
		st := m.status(t)
		assert.Equal(t, vmrunner.StateAbsent, st.State)
		assert.Zero(t, st.Port, "a deleted machine holds no port")
		assert.NotContains(t, m.list(t), m.id)
		require.NoError(t, target.Client.Delete(t.Context(), m.id), "deleting an absent machine succeeds")

		fresh := m.spec()
		fresh.Env = map[string]string{vmprobe.EnvExpectEmpty: "1"}
		m.ensure(t, fresh)
		m.waitReady(t)
	})

	// TEST_SCENARIO: the runner's process restarts under its machines. Its bookkeeping outlives it, so the machine is still known on the port it had, and once asked to run it is ready and published there again.
	t.Run("a restarted runner republishes its ports", func(t *testing.T) {
		if target.Restart == nil {
			t.Skip("this target cannot restart its runner")
		}
		m := newMachine(t, target)
		m.ensure(t, m.spec())
		before := m.waitReady(t)

		target.Restart(t)
		m.waitAnswering(t)
		st := m.ensure(t, m.spec())
		assert.Equal(t, before.Port, st.Port, "a restarted runner moved the machine to another port")
		after := m.waitReady(t)
		assert.Equal(t, before.Port, after.Port)
		m.dialHealthy(t, after.Port)
	})
}

type machine struct {
	id     string
	marker string
	target Target
}

func newMachine(t *testing.T, target Target) *machine {
	t.Helper()
	suffix := make([]byte, 4)
	_, err := rand.Read(suffix)
	require.NoError(t, err)
	m := &machine{id: "conformance-" + hex.EncodeToString(suffix), marker: "marker-" + hex.EncodeToString(suffix), target: target}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := target.Client.Delete(ctx, m.id); err != nil {
			t.Logf("cleaning up machine %s: %v", m.id, err)
		}
	})
	return m
}

func (m *machine) spec() vmrunner.MachineSpec {
	return vmrunner.MachineSpec{
		Image: m.target.Image, CPUs: 1, MemoryMiB: m.target.MemoryMiB, StorageGiB: 1,
		AllowCIDRs: []string{egressBefore}, Revision: "r1", Running: true,
	}
}

func (m *machine) ensure(t *testing.T, spec vmrunner.MachineSpec) vmrunner.MachineStatus {
	t.Helper()
	st, err := m.target.Client.Ensure(t.Context(), m.id, spec)
	require.NoError(t, err)
	return st
}

func (m *machine) status(t *testing.T) vmrunner.MachineStatus {
	t.Helper()
	st, err := m.target.Client.Status(t.Context(), m.id)
	require.NoError(t, err)
	return st
}

func (m *machine) list(t *testing.T) []string {
	t.Helper()
	ids, err := m.target.Client.List(t.Context())
	require.NoError(t, err)
	return ids
}

func (m *machine) waitFor(t *testing.T, what string, done func(vmrunner.MachineStatus) bool) vmrunner.MachineStatus {
	t.Helper()
	deadline := time.Now().Add(m.target.Ready)
	var last vmrunner.MachineStatus
	for {
		st, err := m.target.Client.Status(t.Context(), m.id)
		if err == nil {
			last = st
			if done(st) {
				return st
			}
		}
		require.True(t, time.Now().Before(deadline), "machine %s never became %s: last status %+v, last error %v", m.id, what, last, err)
		time.Sleep(poll)
	}
}

func (m *machine) waitReady(t *testing.T) vmrunner.MachineStatus {
	t.Helper()
	return m.waitFor(t, "ready", func(st vmrunner.MachineStatus) bool {
		return st.Ready && st.State == vmrunner.StateRunning
	})
}

func (m *machine) waitState(t *testing.T, state string) vmrunner.MachineStatus {
	t.Helper()
	return m.waitFor(t, state, func(st vmrunner.MachineStatus) bool { return st.State == state })
}

func (m *machine) waitReason(t *testing.T, reason string) vmrunner.MachineStatus {
	t.Helper()
	return m.waitFor(t, "refused with "+reason, func(st vmrunner.MachineStatus) bool { return st.Reason == reason })
}

// UNIT_BOUNDARY_DESCRIPTION: a restarted runner is unreachable for a while, and an unknown state is its own admission that it cannot read the machine yet — neither is an answer about the machine.
func (m *machine) waitAnswering(t *testing.T) {
	t.Helper()
	m.waitFor(t, "known to the restarted runner", func(st vmrunner.MachineStatus) bool {
		return st.State != vmrunner.StateUnknown
	})
}

func (m *machine) get(t *testing.T, port int, path string) (int, string) {
	t.Helper()
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://%s%s", m.target.Published(port), path))
	require.NoError(t, err, "the machine's published port does not reach its guest")
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

func (m *machine) dialHealthy(t *testing.T, port int) {
	t.Helper()
	if m.target.Published == nil {
		return
	}
	code, body := m.get(t, port, "/healthz")
	assert.Equal(t, http.StatusOK, code, "the published port reached a guest that is not healthy: %s", body)
}

func (m *machine) boot(t *testing.T, port int) string {
	t.Helper()
	if m.target.Published == nil {
		return ""
	}
	code, body := m.get(t, port, vmprobe.BootPath)
	require.Equal(t, http.StatusOK, code)
	require.NotEmpty(t, body)
	return body
}
