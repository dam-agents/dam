import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Envelope: version(1) || nonce(12) || ciphertext(n) || tag(16), base64-encoded.
 * Version byte lets us swap algorithms without a data migration; bump on change.
 */
const ENVELOPE_VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const MIN_LEN = 1 + NONCE_LEN + TAG_LEN;

export interface Cipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
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
      return Buffer.concat([
        Buffer.from([ENVELOPE_VERSION]),
        nonce,
        ct,
        tag,
      ]).toString("base64");
    },
    decrypt(payload) {
      const buf = Buffer.from(payload, "base64");
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
  };
}
