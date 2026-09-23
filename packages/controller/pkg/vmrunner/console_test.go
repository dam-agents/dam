// TEST_OVERVIEW: when a machine fails to boot, or boots and never answers, the Agent's condition must say why — and the only account the host can read is the machine's console, which smolvm writes beside the machine. What must hold: the tail is bounded far inside the 32 KiB a condition message may carry; it is text, with the guest's terminal escapes and control bytes gone; it is redacted with every env value the machine was given, or not shown at all when the runner holds none; a boot that failed carries it with its failure, and a boot that went quiet carries it once it has been quiet past the window, without changing on every poll.
package vmrunner

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeConsole(t *testing.T, id, text string) string {
	t.Helper()
	dir := filepath.Join(os.Getenv("HOME"), ".cache", "smolvm", "vms", "vm-"+id)
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "name"), []byte(id+"\n"), 0o644))
	path := filepath.Join(dir, consoleLogName)
	require.NoError(t, os.WriteFile(path, []byte(text), 0o644))
	return path
}

// UNIT_BOUNDARY_DESCRIPTION: what a boot writes to its console, arranged so the fake runtime writes it during start the way a VMM does. Anything written before the start is gone by then, because every start empties the console.
func bootWrites(t *testing.T, id, text string) string {
	t.Helper()
	path := writeConsole(t, id, "")
	src := filepath.Join(t.TempDir(), "boot")
	require.NoError(t, os.WriteFile(src, []byte(text), 0o644))
	t.Setenv("FAKE_CONSOLE", path)
	t.Setenv("FAKE_CONSOLE_SRC", src)
	return path
}

func longConsole(last string) string {
	var b strings.Builder
	for i := range 2000 {
		fmt.Fprintf(&b, "[    %d.000000] kernel line %d\n", i, i)
	}
	b.WriteString(last + "\n")
	return b.String()
}

// TEST_SCENARIO: a console of any length yields its last few kilobytes, starting on a whole line, with the guest's colour codes and stray control bytes removed and invalid UTF-8 replaced — what reaches a condition is text an operator can read.
func TestTheConsoleTailIsBoundedWholeLinedAndPrintable(t *testing.T) {
	path := filepath.Join(t.TempDir(), consoleLogName)
	require.NoError(t, os.WriteFile(path, []byte(longConsole("\x1b[31mpanic:\x1b[0m no init found\a\r\xff")), 0o644))

	tail := tailOf(path, consoleTailBytes)
	assert.LessOrEqual(t, len(tail), consoleTailBytes+8)
	assert.True(t, strings.HasPrefix(tail, "[ "), "the tail starts on a whole line: %q", tail[:20])
	assert.True(t, strings.HasSuffix(tail, "panic: no init found�"), "got %q", tail[len(tail)-40:])
	assert.NotContains(t, tail, "\x1b")
	assert.NotContains(t, tail, "\a")

	assert.Empty(t, tailOf(filepath.Join(t.TempDir(), "missing"), consoleTailBytes))
}

// TEST_SCENARIO: the runtime refuses to boot the machine. The failure the Agent is told carries the end of the console after it, with the env value the guest printed replaced, and the whole message stays well inside what a condition may hold.
func TestABootFailureCarriesTheRedactedConsoleTail(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("FAKE_START_FAIL_ONCE", "the VMM refused to boot")
	h := newHarness(t)
	secret := spec(true).Env["HTTPS_PROXY"]
	bootWrites(t, "m1", longConsole("platform-init: FATAL: no storage disk; proxy was "+secret))

	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	st := h.settle(t, "m1")

	require.Equal(t, ReasonBootFailed, st.Reason)
	assert.Contains(t, st.Message, "the VMM refused to boot")
	assert.Contains(t, st.Message, "the guest console ends:\n")
	assert.Contains(t, st.Message, "FATAL: no storage disk; proxy was ***")
	assert.NotContains(t, st.Message, secret)
	assert.Less(t, len(st.Message), 8<<10, "a condition message may carry 32 KiB; this stays far inside it")
}

// TEST_SCENARIO: a failure that is not the boot's — an image the runner cannot fetch — has its own explanation, and the console of a machine that never started would only bury it.
func TestOnlyABootFailureCarriesTheConsole(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := newHarness(t)
	writeConsole(t, "m1", "an old boot\n")
	h.node.spawn("m1", StateCreating, func() error { return fmt.Errorf("%w: gone", errImageUnusable) })
	st := h.settle(t, "m1")
	require.Equal(t, ReasonImageUnavailable, st.Reason)
	assert.NotContains(t, st.Message, "console")
}

// TEST_SCENARIO: the guest booted and never answered. Past the window its status explains that with the console's tail, and the note is kept rather than re-read on each poll, so a stuck machine does not rewrite its Agent's condition twice a second. A new start clears it, and so does an answer.
func TestAGuestThatNeverAnswersIsExplainedByItsConsole(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := newHarness(t)
	console := bootWrites(t, "m1", "booting\nsmolvm-agent: waiting for the workload\n")
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	st := h.settle(t, "m1")
	require.False(t, st.Ready)
	assert.Empty(t, st.Message, "inside the window a quiet guest is only slow")

	h.node.mu.Lock()
	h.node.startedAt["m1"] = time.Now().Add(-slowBootAfter - time.Second)
	h.node.mu.Unlock()
	st, err = h.client().Status(t.Context(), "m1")
	require.NoError(t, err)
	assert.Contains(t, st.Message, "not answering its health check")
	assert.Contains(t, st.Message, "the guest console ends:\nbooting\nsmolvm-agent: waiting for the workload")
	assert.Equal(t, ReasonNotReady, orNotReady(st.Reason))

	require.NoError(t, os.WriteFile(console, []byte("something new\n"), 0o644))
	again, err := h.client().Status(t.Context(), "m1")
	require.NoError(t, err)
	assert.Equal(t, st.Message, again.Message, "the note is not rebuilt on every poll")

	h.node.markStarting("m1", StateStarting)
	h.node.mu.Lock()
	_, noted := h.node.slowBoots["m1"]
	h.node.mu.Unlock()
	assert.False(t, noted, "a new start clears the note")
}

// TEST_SCENARIO: the guest answered once, so the machine is up. A probe it misses later, from a busy harness or a slow hypervisor, is a health blip, not a boot the platform still waits on. The stuck-boot note and the starting time belong to that wait, so neither comes back after the answer, however long ago the machine was asked to start.
func TestAMissedProbeAfterTheGuestAnsweredIsNotAStuckBoot(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	require.False(t, h.settle(t, "m1").Ready)
	h.node.mu.Lock()
	h.node.startedAt["m1"] = time.Now().Add(-slowBootAfter - time.Second)
	h.node.mu.Unlock()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", h.node.PortMin+loopbackOffset))
	require.NoError(t, err)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	up, err := h.client().Status(t.Context(), "m1")
	require.NoError(t, err)
	require.True(t, up.Ready)
	assert.Empty(t, up.Message)

	require.NoError(t, srv.Close())
	down, err := h.client().Status(t.Context(), "m1")
	require.NoError(t, err)
	assert.False(t, down.Ready)
	assert.Empty(t, down.Message, "a missed probe after the answer is not a stuck boot")
	assert.Zero(t, down.StartingMs, "a machine that answered is no longer starting")
}

// TEST_SCENARIO: a machine stopped before its guest ever answered has nothing left to wait for. Its stop ends the boot, so the stopped machine reports no starting time and no stuck-boot note, however long ago it was asked to start.
func TestAStopEndsTheBootWait(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := newHarness(t)
	_, err := h.client().Ensure(t.Context(), "m1", spec(true))
	require.NoError(t, err)
	require.False(t, h.settle(t, "m1").Ready)
	h.node.mu.Lock()
	h.node.startedAt["m1"] = time.Now().Add(-slowBootAfter - time.Second)
	h.node.mu.Unlock()
	_, err = h.client().Ensure(t.Context(), "m1", spec(false))
	require.NoError(t, err)
	st := h.settle(t, "m1")
	assert.Equal(t, StateStopped, st.State)
	assert.Zero(t, st.StartingMs, "a stopped machine is not starting")
	assert.Empty(t, st.Message)
}

func orNotReady(reason string) string {
	if reason == "" {
		return ReasonNotReady
	}
	return reason
}

// TEST_SCENARIO: the runner restarted and holds no spec for a machine it finds, so it has nothing to redact the console with — and a console it cannot redact is not shown.
func TestAConsoleTheRunnerCannotRedactIsNotShown(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := newHarness(t)
	writeConsole(t, "m9", "OPENAI_API_KEY=sk-live-abc123\n")
	assert.Empty(t, h.node.consoleTail("m9"))

	h.node.rememberSecrets("m9", MachineSpec{Env: map[string]string{"OPENAI_API_KEY": "sk-live-abc123"}})
	assert.Equal(t, "OPENAI_API_KEY=***", h.node.consoleTail("m9"))

	h.node.rememberSecrets("m9", MachineSpec{Env: map[string]string{"OPENAI_API_KEY": "sk-live-rotated"}})
	assert.Equal(t, "OPENAI_API_KEY=***", h.node.consoleTail("m9"), "a value the machine no longer has is still redacted: the console holds earlier boots")
}

// TEST_SCENARIO: an earlier boot printed a Secret, the operator rotated it, and the runner restarted and so forgot the old value. The console still holds that boot. Starting the machine again empties it first, so no later tail can quote a value the runner no longer knows to redact.
func TestAStartEmptiesTheConsoleAnEarlierBootLeft(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := newHarness(t)
	console := writeConsole(t, "m1", "OPENAI_API_KEY=sk-live-withdrawn\n")
	require.NoError(t, os.WriteFile(filepath.Join(h.state, "m1"), []byte("stopped"), 0o644))

	require.NoError(t, h.node.Runtime.Start("m1"))

	body, err := os.ReadFile(console)
	require.NoError(t, err)
	assert.Empty(t, body, "the withdrawn value is gone before the new boot writes anything")
}
