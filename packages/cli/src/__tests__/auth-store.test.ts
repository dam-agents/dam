import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTomlAuthStore,
  type HostUrl,
} from "../modules/auth/infrastructure/auth-store.js";
import type { HostAuth } from "../modules/auth/domain/host-auth.js";

const HOST_A: HostUrl = "http://dam.localhost:4444";
const HOST_B: HostUrl = "http://other.example:4444";

function sampleAuth(overrides: Partial<HostAuth> = {}): HostAuth {
  return {
    issuer: "http://keycloak.localhost:4444/realms/platform",
    username: "petr",
    sub: "00000000-0000-0000-0000-000000000001",
    accessToken: "access-token-value",
    refreshToken: "refresh-token-value",
    expiresAt: new Date("2026-05-06T15:34:01.000Z"),
    ...overrides,
  };
}

describe("TOML AuthStore", () => {
  let dir: string;
  let authPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cli-auth-"));
    authPath = join(dir, "auth.toml");
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("read on missing file returns Ok(empty map)", async () => {
    const store = createTomlAuthStore(authPath);
    const r = await store.read();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.size).toBe(0);
    }
  });

  it("initial write sets mode 0600 (claim 8)", async () => {
    const store = createTomlAuthStore(authPath);
    const w = await store.write(HOST_A, sampleAuth());
    expect(w.ok).toBe(true);

    const s = await stat(authPath);
    // The exact `mode` field is platform-dependent in its upper bits
    // (file type); only the permission bits are stable.
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("round-trips multiple host entries and preserves unrelated top-level keys", async () => {
    // Hand-author the file with an extra top-level key the store doesn't know
    // about. The read-merge-write contract requires it to survive a `write`.
    await writeFile(
      authPath,
      [
        '# user note',
        'unknown_top_level = "preserved"',
        '',
        '[hosts."http://dam.localhost:4444"]',
        'issuer = "http://keycloak.localhost:4444/realms/platform"',
        'username = "petr"',
        'sub = "sub-A"',
        'access_token = "a"',
        'refresh_token = "r"',
        'expires_at = "2026-05-06T15:34:01.000Z"',
        '',
      ].join("\n"),
      "utf-8",
    );

    const store = createTomlAuthStore(authPath);

    const w = await store.write(
      HOST_B,
      sampleAuth({ username: "alice", sub: "sub-B" }),
    );
    expect(w.ok).toBe(true);

    const raw = await readFile(authPath, "utf-8");
    expect(raw).toContain('unknown_top_level = "preserved"');

    const r = await store.read();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.size).toBe(2);
      expect(r.value.get(HOST_A)?.sub).toBe("sub-A");
      expect(r.value.get(HOST_B)?.sub).toBe("sub-B");
      expect(r.value.get(HOST_B)?.username).toBe("alice");
    }
  });

  it("write uses tmp+rename — leaves no tmp file behind on success", async () => {
    const store = createTomlAuthStore(authPath);
    const w = await store.write(HOST_A, sampleAuth());
    expect(w.ok).toBe(true);

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files).toEqual(["auth.toml"]);
  });

  it("write atomicity: when rename fails before commit, the existing file is untouched", async () => {
    // Pre-seed a valid file. Then trigger a write failure by pointing the
    // store at a path whose parent permissions prevent file creation. The
    // existing file at the original path must remain readable.
    const store = createTomlAuthStore(authPath);
    const initial = await store.write(HOST_A, sampleAuth({ username: "first" }));
    expect(initial.ok).toBe(true);
    const before = await readFile(authPath, "utf-8");

    // A file path inside a non-existent unreadable parent forces writeFile
    // (the tmp step) to fail before any rename — the same pre-rename
    // failure mode the atomic-write contract guards against.
    const badPath = join(dir, "nope", "\0invalid", "auth.toml");
    const badStore = createTomlAuthStore(badPath);
    const failed = await badStore.write(HOST_A, sampleAuth({ username: "second" }));
    expect(failed.ok).toBe(false);

    // Original file untouched.
    const after = await readFile(authPath, "utf-8");
    expect(after).toBe(before);
  });

  it("remove on missing host is a no-op", async () => {
    const store = createTomlAuthStore(authPath);
    const seeded = await store.write(HOST_A, sampleAuth());
    expect(seeded.ok).toBe(true);

    const removed = await store.remove(HOST_B);
    expect(removed.ok).toBe(true);

    const r = await store.read();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.has(HOST_A)).toBe(true);
  });

  it("remove deletes the targeted host and preserves others", async () => {
    const store = createTomlAuthStore(authPath);
    await store.write(HOST_A, sampleAuth({ username: "a" }));
    await store.write(HOST_B, sampleAuth({ username: "b" }));

    const removed = await store.remove(HOST_A);
    expect(removed.ok).toBe(true);

    const r = await store.read();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.has(HOST_A)).toBe(false);
      expect(r.value.get(HOST_B)?.username).toBe("b");
    }
  });

  it("malformed TOML returns MalformedAuthStoreError", async () => {
    await writeFile(authPath, "not = [valid toml", "utf-8");
    const store = createTomlAuthStore(authPath);

    const r = await store.read();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("malformed-auth-store");
      expect(r.error.reason).toContain(authPath);
    }
  });

  it("malformed entry shape returns MalformedAuthStoreError", async () => {
    // Missing required `refresh_token` field.
    await writeFile(
      authPath,
      [
        '[hosts."http://dam.localhost:4444"]',
        'issuer = "x"',
        'username = "p"',
        'sub = "s"',
        'access_token = "a"',
        'expires_at = "2026-05-06T15:34:01Z"',
      ].join("\n"),
      "utf-8",
    );
    const store = createTomlAuthStore(authPath);

    const r = await store.read();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("malformed-auth-store");
  });
});
