import { createHmac, randomBytes } from "node:crypto";
import { API_KEY_PREFIX } from "api-server-api";

const RANDOM_BYTES = 32;

export interface ApiKeyTokenCodec {
  mint(): { token: string; hash: string };
  hash(token: string): string;
}

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
    const token =
      API_KEY_PREFIX + randomBytes(RANDOM_BYTES).toString("base64url");
    return { token, hash: hash(token) };
  }

  return { mint, hash };
}

export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}
