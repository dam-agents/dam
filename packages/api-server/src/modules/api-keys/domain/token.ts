import { createHash, randomBytes } from "node:crypto";
import { API_KEY_PREFIX } from "api-server-api";

const RANDOM_BYTES = 32;

// RFC 4648 base32, lowercase, no padding. Picked over base64url because
// shells, copy-paste tools, and `--token=` flags in screenshots survive
// base32 round-trips without case folding hazards. 32B → 52 chars.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

export function mintApiKeyToken(): { token: string; hash: string } {
  const token = API_KEY_PREFIX + base32(randomBytes(RANDOM_BYTES));
  return { token, hash: hashApiKeyToken(token) };
}

/**
 * Server-side digest of an API key token. The token is 256 bits of
 * cryptographic randomness (32 random bytes, base32-encoded), not a
 * user-chosen password — SHA-256 over a high-entropy random string is
 * brute-force-infeasible, so a slow password hash (argon2id / bcrypt /
 * scrypt) would solve a problem we do not have.
 */
// lgtm[js/insufficient-password-hash]
export function hashApiKeyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}
