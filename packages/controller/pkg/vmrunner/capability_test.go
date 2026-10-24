package vmrunner

import (
	"testing"

	"github.com/stretchr/testify/assert"
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

// TEST_SCENARIO: the controller mints the usage capability in Go and the runner checks it in Rust; minting from the fixture's token must give exactly its capability, and the capability must not carry the token.
func TestAUsageCapabilityIsWhatTheContractSays(t *testing.T) {
	fixture := decodeStrictly[struct {
		Token      string `json:"token"`
		Capability string `json:"capability"`
	}](t, "usage-capability.json", contractFixture(t, "usage-capability.json"))

	got := MintUsageCapability(fixture.Token)
	assert.Equal(t, fixture.Capability, got)
	assert.NotContains(t, got, fixture.Token)
}
