import { createHmac, randomBytes } from "node:crypto";
import { API_KEY_PREFIX } from "api-server-api";

const RANDOM_BYTES = 32;

export interface ApiKeyTokenCodec {
  /** Generate a fresh token + its at-rest digest. */
  mint(): { token: string; hash: string };
  /** Recompute the at-rest digest for an incoming token (validation path). */
  hash(token: string): string;
}

/**
 * Token codec bound to a server-side HMAC key (a "pepper"). The token itself
 * is 256 bits of cryptographic randomness, so brute-forcing the digest is
 * already infeasible; the pepper adds defense-in-depth — a Postgres-only leak
 * (without the app secret) yields digests an attacker cannot even verify a
 * guessed token against. HMAC-SHA256 keeps per-request validation cheap, which
 * a slow KDF (argon2id/bcrypt/scrypt) would not — and a KDF buys nothing for a
 * high-entropy random secret.
 *
 * The key must be stable across restarts — rotating it invalidates every
 * existing key (digests stop matching). The Helm chart generates and persists
 * it in a Secret, mirroring `ACTIVITY_HMAC_KEY`.
 */
export function createApiKeyTokenCodec(hmacKey: string): ApiKeyTokenCodec {
  if (!hmacKey) {
    throw new Error(
      "api-keys: API_KEY_HMAC_KEY must be set — refusing to hash tokens without a server-side pepper",
    );
  }

  function hash(token: string): string {
    return createHmac("sha256", hmacKey).update(token).digest("hex");
  }

  function mint(): { token: string; hash: string } {
    // base64url: stdlib-supported (no hand-rolled encoder and its trailing-bits
    // edge case), shorter than base32 (43 chars vs 52 for 32B of entropy), and
    // the standard high-entropy bearer-token shape. Case-sensitivity is fine —
    // modern shells, clipboards, and screenshot OCR all preserve case.
    const token =
      API_KEY_PREFIX + randomBytes(RANDOM_BYTES).toString("base64url");
    return { token, hash: hash(token) };
  }

  return { mint, hash };
}

export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}
