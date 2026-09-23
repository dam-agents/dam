package vmrunner

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TEST_OVERVIEW: the machine API's wire types are one half of a contract whose other half is the vm runner, in Rust. The two processes meet as JSON, so a renamed field, a dropped one, or an omitempty only one side applies does not fail a build — it fails at runtime as a value that silently reads as its zero. Both sides are held to the same JSON documents under packages/vm-runner/contract instead, and neither reads the other's source.

func contractFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vm-runner", "contract", name))
	require.NoError(t, err)
	return raw
}

func decodeStrictly[T any](t *testing.T, name string, raw []byte) T {
	t.Helper()
	var value T
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	require.NoError(t, decoder.Decode(&value), "%s holds a field the controller does not know", name)
	return value
}

// UNIT_BOUNDARY_DESCRIPTION: holds one wire type to its two fixtures. The full fixture must decode with no field left over and fill every field of the struct, so a field either side adds fails here until the fixture holds it; it must also equal `filled` and be what `filled` encodes to. The zero fixture is exactly what the zero value encodes to, which is where an omitempty that differs from the runner's skip condition shows.
func matchesTheContract[T any](t *testing.T, name string, filled T) {
	t.Helper()
	full := contractFixture(t, name+".json")
	zero := contractFixture(t, name+".zero.json")

	decoded := decodeStrictly[T](t, name+".json", full)
	fields := reflect.ValueOf(decoded)
	for i := range fields.NumField() {
		assert.False(t, fields.Field(i).IsZero(),
			"%s.json leaves %s unset, so nothing holds the runner to that field", name, fields.Type().Field(i).Name)
	}
	assert.Equal(t, filled, decoded)

	written, err := json.Marshal(filled)
	require.NoError(t, err)
	assert.JSONEq(t, string(full), string(written), "a %s with every field set does not encode as the fixture", name)

	var empty T
	written, err = json.Marshal(empty)
	require.NoError(t, err)
	assert.JSONEq(t, string(zero), string(written), "the zero %s does not encode as the zero fixture", name)
	assert.Equal(t, empty, decodeStrictly[T](t, name+".zero.json", zero))
}

func TestTheWireTypesWriteAndReadWhatTheContractSays(t *testing.T) {
	matchesTheContract(t, "machine-spec", MachineSpec{
		Image:      "quay.io/x/vm:1",
		CPUs:       2,
		MemoryMiB:  2048,
		StorageGiB: 20,
		Env:        map[string]string{"A": "b"},
		CACert:     "-----BEGIN CERTIFICATE-----",
		AllowCIDRs: []string{"10.0.0.1/32"},
		Revision:   "r1",
		Running:    true,
		PullAuths:  []string{`{"auths":{}}`},
	})
	matchesTheContract(t, "machine-status", MachineStatus{
		State:     StateRunning,
		Reason:    ReasonNotReady,
		Restarts:  1,
		Port:      31000,
		Ready:     true,
		CPUs:      2,
		MemoryMiB: 2048,
		Message:   "up",
		Version:   1,
	})
}

// TEST_SCENARIO: the states and reasons are the vocabulary the controller matches on. A value that differs by a character is not a compile error on either side — it is a controller that never recognises the state its runner is reporting, so the Agent sits in a condition nothing clears.
func TestTheStatesAndReasonsAreTheOnesTheRunnerReports(t *testing.T) {
	vocabulary := decodeStrictly[struct {
		States  []string `json:"states"`
		Reasons []string `json:"reasons"`
	}](t, "vocabulary.json", contractFixture(t, "vocabulary.json"))

	assert.Equal(t, []string{
		StateAbsent, StateUnknown, StateCreating, StateStarting,
		StateRestarting, StateRunning, StateStopping, StateStopped,
	}, vocabulary.States)
	assert.Equal(t, []string{
		ReasonNotReady, ReasonOutOfCapacity, ReasonImageUnavailable, ReasonBootFailed,
	}, vocabulary.Reasons)
}
