use sha2::{Digest, Sha256};

// UNIT_BOUNDARY_DESCRIPTION: the seed capability: what the controller gives a runtime migration's copy Job in place of the runner's token. The Job parses data an agent wrote, so it must not hold the token, which drives every route of the machine API for every machine of the owner. A capability names one machine, one nonce and an expiry, signed with HMAC-SHA256 under a key derived from the runner's token, so the runner checks it without a second secret to distribute and the Job cannot work the token back out of it. It is good only for the seed route of the machine it names; that it is used once, and only on a machine created for a migration that has no home yet, is the server's to enforce, since only the server knows the machine. The controller mints it with the same derivation, held to contract/seed-capability.json on both sides.

const PREFIX: &str = "seedcap1";

// UNIT_BOUNDARY_DESCRIPTION: the label the key is derived under. Changing it invalidates every capability minted with the old one, so it names its version.
const KEY_LABEL: &[u8] = b"vm-runner seed capability key v1";

// UNIT_BOUNDARY_DESCRIPTION: the one route a capability is good for, signed into the message so a key reused for another scope later cannot turn a seed capability into that one.
const SCOPE: &str = "seed";

const NONCE_HEX: usize = 32;
const MAC_HEX: usize = 64;

// UNIT_BOUNDARY_DESCRIPTION: why a presented capability was refused before any machine was looked at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Invalid,
    Expired,
}

// UNIT_BOUNDARY_DESCRIPTION: a capability whose signature and expiry have been checked for one machine. `fingerprint` names it in logs without being it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    pub nonce: String,
    pub expires: u64,
    pub fingerprint: String,
}

pub fn derive_key(token: &[u8]) -> [u8; 32] {
    hmac_sha256(token, KEY_LABEL)
}

// UNIT_BOUNDARY_DESCRIPTION: whether a bearer is shaped as a capability at all, so a request that carries neither the token nor a capability is answered as unauthorized and never as a malformed capability.
pub fn looks_like(bearer: &str) -> bool {
    bearer.starts_with(PREFIX) && bearer.as_bytes().get(PREFIX.len()) == Some(&b'.')
}

#[cfg(test)]
pub fn mint(key: &[u8; 32], machine: &str, nonce: &str, expires: u64) -> String {
    let mac = hmac_sha256(key, message(machine, nonce, expires).as_bytes());
    format!("{PREFIX}.{nonce}.{expires}.{}", hex(&mac))
}

pub fn verify(key: &[u8; 32], bearer: &str, machine: &str, now: u64) -> Result<Verified, Refusal> {
    let mut parts = bearer.split('.');
    let (Some(PREFIX), Some(nonce), Some(expires), Some(mac), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(Refusal::Invalid);
    };
    let well_formed = nonce.len() == NONCE_HEX
        && is_lower_hex(nonce)
        && mac.len() == MAC_HEX
        && is_lower_hex(mac)
        && !expires.is_empty()
        && expires.bytes().all(|b| b.is_ascii_digit());
    let Some(expires) = well_formed.then(|| expires.parse::<u64>().ok()).flatten() else {
        return Err(Refusal::Invalid);
    };
    let want = hex(&hmac_sha256(
        key,
        message(machine, nonce, expires).as_bytes(),
    ));
    if !crate::http::constant_time_eq(mac.as_bytes(), want.as_bytes()) {
        return Err(Refusal::Invalid);
    }
    if now >= expires {
        return Err(Refusal::Expired);
    }
    Ok(Verified {
        nonce: nonce.to_string(),
        expires,
        fingerprint: fingerprint(bearer),
    })
}

// UNIT_BOUNDARY_DESCRIPTION: the first 16 hex characters of the capability's SHA-256. The controller logs the same one when it mints, so the upload a runner accepted can be tied to the Job it was minted for without either log holding the capability.
pub fn fingerprint(bearer: &str) -> String {
    hex(&Sha256::digest(bearer.as_bytes()))[..16].to_string()
}

fn message(machine: &str, nonce: &str, expires: u64) -> String {
    format!("{machine}|{SCOPE}|{nonce}|{expires}")
}

fn is_lower_hex(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// UNIT_BOUNDARY_DESCRIPTION: HMAC-SHA256 as RFC 2104 defines it, over the sha2 crate the runner already links, rather than a new dependency for twenty lines. Pinned to RFC 4231's test vectors below.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let pad = |byte: u8| -> [u8; BLOCK] { block.map(|b| b ^ byte) };
    let inner = Sha256::new()
        .chain_update(pad(0x36))
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(pad(0x5c))
        .chain_update(inner)
        .finalize()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONCE: &str = "00112233445566778899aabbccddeeff";

    // TEST_SCENARIO: the MAC is hand-written, so it is held to the published vectors: RFC 4231 cases 1 and 6, a short key and one longer than the block, which is hashed first.
    #[test]
    fn the_mac_is_hmac_sha256() {
        assert_eq!(
            hex(&hmac_sha256(&[0x0b; 20], b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        assert_eq!(
            hex(&hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    // TEST_SCENARIO: the controller mints in Go and the runner verifies in Rust, and nothing but a shared document holds the two derivations together. The fixture's capability must be what this side mints from its token, machine, nonce and expiry, and must verify for that machine.
    #[test]
    fn a_capability_is_what_the_contract_says() {
        let path = format!(
            "{}/contract/seed-capability.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let field = |name: &str| fixture[name].as_str().unwrap().to_string();
        let expires = fixture["expires"].as_u64().unwrap();
        let key = derive_key(field("token").as_bytes());
        assert_eq!(
            mint(&key, &field("machine"), &field("nonce"), expires),
            field("capability")
        );
        let verified = verify(&key, &field("capability"), &field("machine"), expires - 1).unwrap();
        assert_eq!(verified.fingerprint, field("fingerprint"));
    }

    // TEST_SCENARIO: a capability names one machine. The Job for machine A presenting it on machine B's seed route is refused, as is a capability signed under another runner's token.
    #[test]
    fn a_capability_for_one_machine_is_refused_for_another() {
        let key = derive_key(b"token");
        let capability = mint(&key, "agent-a", NONCE, 100);
        assert!(verify(&key, &capability, "agent-a", 10).is_ok());
        assert_eq!(
            verify(&key, &capability, "agent-b", 10),
            Err(Refusal::Invalid)
        );
        assert_eq!(
            verify(&derive_key(b"other"), &capability, "agent-a", 10),
            Err(Refusal::Invalid)
        );
    }

    // TEST_SCENARIO: a capability is good only until its expiry, which the controller sets just past the Job's active deadline. From that second on it is refused.
    #[test]
    fn an_expired_capability_is_refused() {
        let key = derive_key(b"token");
        let capability = mint(&key, "agent-a", NONCE, 100);
        assert!(verify(&key, &capability, "agent-a", 99).is_ok());
        assert_eq!(
            verify(&key, &capability, "agent-a", 100),
            Err(Refusal::Expired)
        );
    }

    // TEST_SCENARIO: the expiry and nonce are signed, so a Job that moves its own expiry forward, or strips a field, holds nothing the runner accepts.
    #[test]
    fn an_altered_capability_is_refused() {
        let key = derive_key(b"token");
        let capability = mint(&key, "agent-a", NONCE, 100);
        for altered in [
            capability.replace(".100.", ".999."),
            capability.replace(NONCE, "ffffffffffffffffffffffffffffffff"),
            capability.rsplit_once('.').unwrap().0.to_string(),
            format!("{capability}.x"),
            capability.to_uppercase(),
            String::new(),
        ] {
            assert_eq!(
                verify(&key, &altered, "agent-a", 10),
                Err(Refusal::Invalid),
                "{altered}"
            );
        }
    }

    // TEST_SCENARIO: the key is derived from the token and is not the token, so a capability says nothing a Job could use against the other routes.
    #[test]
    fn the_key_is_not_the_token() {
        let key = derive_key(b"token");
        assert_ne!(&key[..5], b"token");
        assert_ne!(key, derive_key(b"token2"));
        assert!(looks_like(&mint(&key, "a", NONCE, 1)));
        assert!(!looks_like("0123abcd"));
    }
}
