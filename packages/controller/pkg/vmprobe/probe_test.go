// TEST_OVERVIEW: the probe guest turns what its disk held at boot into its health answer, which is the only way the conformance suite can read a machine's disk. What must hold: an expectation is judged against the disk as the guest found it, never against the guest's own write; a guest with no expectation is healthy; a mismatch is unhealthy and says why.
package vmprobe

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func health(t *testing.T, g Guest) (int, string) {
	t.Helper()
	handler, err := g.Boot()
	require.NoError(t, err)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	return rec.Code, rec.Body.String()
}

// TEST_SCENARIO: the first boot writes the marker, a later boot expects it; a guest told both to write and to expect on a fresh disk is unhealthy, because the marker it would find is its own.
func TestAnExpectationIsJudgedOnTheDiskAsItWasAtBoot(t *testing.T) {
	dir := t.TempDir()
	code, _ := health(t, Guest{Dir: dir, Write: "m1"})
	assert.Equal(t, http.StatusOK, code, "a guest with no expectation is healthy")

	code, _ = health(t, Guest{Dir: dir, Expect: "m1"})
	assert.Equal(t, http.StatusOK, code, "the marker the first boot wrote is there")

	fresh := t.TempDir()
	code, body := health(t, Guest{Dir: fresh, Write: "m2", Expect: "m2"})
	assert.Equal(t, http.StatusServiceUnavailable, code)
	assert.Contains(t, body, `expected "m2"`)
}

// TEST_SCENARIO: after a delete the disk must be empty; a guest expecting that is healthy only when no marker is left.
func TestExpectingAnEmptyDiskFailsOnAnyMarker(t *testing.T) {
	dir := t.TempDir()
	code, _ := health(t, Guest{Dir: dir, ExpectEmpty: true})
	assert.Equal(t, http.StatusOK, code)

	require.NoError(t, os.WriteFile(filepath.Join(dir, MarkerFile), []byte("left behind"), 0o644))
	code, body := health(t, Guest{Dir: dir, ExpectEmpty: true})
	assert.Equal(t, http.StatusServiceUnavailable, code)
	assert.Contains(t, body, "left behind")
}

// TEST_SCENARIO: a probe that looked anywhere but the persisted home would judge a directory the machine discards at every stop, and would pass a runner that lost the disk. Its default is held to the guest fixture that platform-init's own tests read.
func TestTheProbeLooksWherePlatformInitMountsTheDisk(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vm-runner", "contract", "guest.json"))
	require.NoError(t, err)
	var guest struct {
		AgentHome string `json:"agentHome"`
	}
	require.NoError(t, json.Unmarshal(raw, &guest))
	assert.Equal(t, guest.AgentHome, AgentHome)
	assert.Equal(t, AgentHome, FromEnv(func(string) string { return "" }).Dir)
}
