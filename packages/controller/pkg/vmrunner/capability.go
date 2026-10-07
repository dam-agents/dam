package vmrunner

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// UNIT_BOUNDARY_DESCRIPTION: the seed capability a runtime migration's copy Job carries in place of the runner's token. The Job parses data an agent wrote, and the token drives every route of the machine API for every machine of the owner, so the Job gets a capability that the runner accepts only on the seed upload of the one machine it names, once, before it expires, and only while that machine is marked as migrating and holds no home. It is an HMAC-SHA256 over the machine, the seed scope, a random nonce and the expiry, keyed with a key derived from the runner's token under a fixed label, so the runner checks it with no second secret to distribute and the Job cannot work the token back out of it. The runner verifies it in Rust; contract/seed-capability.json holds both sides to one derivation.
const (
	seedCapabilityPrefix   = "seedcap1"
	seedCapabilityKeyLabel = "vm-runner seed capability key v1"
	seedCapabilityScope    = "seed"
)

// UNIT_BOUNDARY_DESCRIPTION: a fresh capability for seeding `machine` until `expires`, with a nonce from the operating system's CSPRNG, and the fingerprint the runner logs it under.
func NewSeedCapability(token, machine string, expires time.Time) (capability, fingerprint string, err error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", "", fmt.Errorf("drawing a seed capability nonce: %w", err)
	}
	capability = MintSeedCapability(token, machine, hex.EncodeToString(nonce), expires.Unix())
	return capability, SeedCapabilityFingerprint(capability), nil
}

func MintSeedCapability(token, machine, nonce string, expires int64) string {
	key := hmacSHA256([]byte(token), []byte(seedCapabilityKeyLabel))
	mac := hmacSHA256(key, fmt.Appendf(nil, "%s|%s|%s|%d", machine, seedCapabilityScope, nonce, expires))
	return fmt.Sprintf("%s.%s.%d.%s", seedCapabilityPrefix, nonce, expires, hex.EncodeToString(mac))
}

// UNIT_BOUNDARY_DESCRIPTION: the first 16 hex characters of the capability's SHA-256, which is how both the controller and the runner name it in logs without either holding it there.
func SeedCapabilityFingerprint(capability string) string {
	sum := sha256.Sum256([]byte(capability))
	return hex.EncodeToString(sum[:])[:16]
}

func hmacSHA256(key, message []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(message)
	return mac.Sum(nil)
}
