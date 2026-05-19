import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Stored form: "enc:" + base64(version(1) || nonce(12) || ciphertext(n) || tag(16)).
 * The "enc:" prefix is the lazy-migration discriminator — callers use
 * `isEncrypted` to tell stored ciphertext from legacy plaintext refresh
 * tokens (which are Keycloak JWTs / opaque tokens that never start with
 * "enc:"). The inner version byte lets us swap algorithms without a data
 * migration; bump on change.
 */
const PREFIX = "enc:";
const ENVELOPE_VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const MIN_LEN = 1 + NONCE_LEN + TAG_LEN;

export interface Cipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
  isEncrypted(value: string): boolean;
}

export function createCipher(keyBase64: string): Cipher {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `encryption key must be ${KEY_LEN} bytes (got ${key.length})`,
    );
  }
  return {
    encrypt(plaintext) {
      const nonce = randomBytes(NONCE_LEN);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ct = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      const envelope = Buffer.concat([
        Buffer.from([ENVELOPE_VERSION]),
        nonce,
        ct,
        tag,
      ]).toString("base64");
      return PREFIX + envelope;
    },
    decrypt(payload) {
      if (!payload.startsWith(PREFIX)) {
        throw new Error("missing ciphertext prefix");
      }
      const buf = Buffer.from(payload.slice(PREFIX.length), "base64");
      if (buf.length < MIN_LEN) {
        throw new Error("ciphertext envelope too short");
      }
      if (buf[0] !== ENVELOPE_VERSION) {
        throw new Error(
          `unsupported envelope version: 0x${buf[0].toString(16)}`,
        );
      }
      const nonce = buf.subarray(1, 1 + NONCE_LEN);
      const tag = buf.subarray(buf.length - TAG_LEN);
      const ct = buf.subarray(1 + NONCE_LEN, buf.length - TAG_LEN);
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
        "utf8",
      );
    },
    isEncrypted(value) {
      return value.startsWith(PREFIX);
    },
  };
}
