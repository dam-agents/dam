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
    cliClientId: "platform-cli",
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

  // Claim 8 (analysis §7.1) — the real security property.
  it("initial write sets mode 0600", async () => {
    const store = createTomlAuthStore(authPath);
    const w = await store.write(HOST_A, sampleAuth());
    expect(w.ok).toBe(true);

    const s = await stat(authPath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  // Spec-promised read-merge-write contract. If this regresses, hand-edited
  // user comments and unknown top-level keys silently disappear on write.
  it("write preserves multiple host entries and unrelated top-level keys", async () => {
    await writeFile(
      authPath,
      [
        "# user note",
        'unknown_top_level = "preserved"',
        "",
        '[hosts."http://dam.localhost:4444"]',
        'issuer = "http://keycloak.localhost:4444/realms/platform"',
        'username = "petr"',
        'sub = "sub-A"',
        'cli_client_id = "platform-cli"',
        'access_token = "a"',
        'refresh_token = "r"',
        'expires_at = "2026-05-06T15:34:01.000Z"',
        "",
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
      expect(r.value.get(HOST_B)?.username).toBe("alice");
    }
  });

  // Logout idempotency contract — auth-service.logout returns success on
  // unknown host without rewriting. A no-op `remove` keeps the file clean.
  it("remove targeted host preserves others; remove on missing host is a no-op", async () => {
    const store = createTomlAuthStore(authPath);
    await store.write(HOST_A, sampleAuth({ username: "a" }));
    await store.write(HOST_B, sampleAuth({ username: "b" }));

    const removeA = await store.remove(HOST_A);
    expect(removeA.ok).toBe(true);

    const r1 = await store.read();
    if (r1.ok) {
      expect(r1.value.has(HOST_A)).toBe(false);
      expect(r1.value.get(HOST_B)?.username).toBe("b");
    }

    const removeAgain = await store.remove(HOST_A);
    expect(removeAgain.ok).toBe(true);
  });
});
