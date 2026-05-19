import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createCipher } from "../../modules/channels/infrastructure/cipher.js";

const newKey = () => randomBytes(32).toString("base64");

describe("createCipher", () => {
  it("round-trips ascii", () => {
    const c = createCipher(newKey());
    expect(c.decrypt(c.encrypt("hello world"))).toBe("hello world");
  });

  it("round-trips empty string", () => {
    const c = createCipher(newKey());
    expect(c.decrypt(c.encrypt(""))).toBe("");
  });

  it("round-trips unicode", () => {
    const c = createCipher(newKey());
    const s = "héllo 🌍 私";
    expect(c.decrypt(c.encrypt(s))).toBe(s);
  });

  it("emits a fresh nonce per call (same input → different ciphertext)", () => {
    const c = createCipher(newKey());
    expect(c.encrypt("x")).not.toBe(c.encrypt("x"));
  });

  it("rejects tampered ciphertext", () => {
    const c = createCipher(newKey());
    const buf = Buffer.from(c.encrypt("hello"), "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => c.decrypt(buf.toString("base64"))).toThrow();
  });

  it("rejects ciphertext encrypted under a different key", () => {
    const a = createCipher(newKey());
    const b = createCipher(newKey());
    expect(() => b.decrypt(a.encrypt("hello"))).toThrow();
  });

  it("rejects an unknown envelope version", () => {
    const c = createCipher(newKey());
    const buf = Buffer.concat([Buffer.from([0xff]), randomBytes(28)]);
    expect(() => c.decrypt(buf.toString("base64"))).toThrow(/version/);
  });

  it("rejects truncated input", () => {
    const c = createCipher(newKey());
    expect(() =>
      c.decrypt(Buffer.from([0x01, 0x02, 0x03]).toString("base64")),
    ).toThrow(/short/);
  });

  it("rejects a wrong-length key at construction", () => {
    expect(() => createCipher(Buffer.alloc(16).toString("base64"))).toThrow(
      /bytes/,
    );
  });
});
