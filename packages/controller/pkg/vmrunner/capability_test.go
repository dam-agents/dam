package vmrunner

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TEST_SCENARIO: the controller mints a seed capability in Go and the runner verifies it in Rust, so nothing but a shared document holds the two derivations together. Minting from the fixture's token, machine, nonce and expiry must give exactly its capability and fingerprint.
func TestASeedCapabilityIsWhatTheContractSays(t *testing.T) {
	fixture := decodeStrictly[struct {
		Token       string `json:"token"`
		Machine     string `json:"machine"`
		Nonce       string `json:"nonce"`
		Expires     int64  `json:"expires"`
		Capability  string `json:"capability"`
		Fingerprint string `json:"fingerprint"`
	}](t, "seed-capability.json", contractFixture(t, "seed-capability.json"))

	got := MintSeedCapability(fixture.Token, fixture.Machine, fixture.Nonce, fixture.Expires)
	assert.Equal(t, fixture.Capability, got)
	assert.Equal(t, fixture.Fingerprint, SeedCapabilityFingerprint(got))
}

// TEST_SCENARIO: every capability is minted with a fresh nonce, so two Jobs for one machine never hold the same one, and none of them carries the token it was derived from.
func TestEachSeedCapabilityIsFreshAndHoldsNoToken(t *testing.T) {
	expires := time.Unix(1790000000, 0)
	first, fp, err := NewSeedCapability("the-runner-token", "my-agent", expires)
	require.NoError(t, err)
	second, _, err := NewSeedCapability("the-runner-token", "my-agent", expires)
	require.NoError(t, err)
	assert.NotEqual(t, first, second)
	assert.Equal(t, SeedCapabilityFingerprint(first), fp)
	assert.NotContains(t, first, "the-runner-token")
	parts := strings.Split(first, ".")
	require.Len(t, parts, 4)
	assert.Equal(t, "seedcap1", parts[0])
	assert.Len(t, parts[1], 32)
	assert.Equal(t, "1790000000", parts[2])
}
