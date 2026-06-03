import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSshService } from "../../modules/ssh.js";

// A real (throwaway) ed25519 public key line.
const KEY_A =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA dam-cli";
const KEY_B =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB other";

describe("createSshService.authorizeKey", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dam-ssh-svc-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const authorized = () =>
    readFileSync(join(home, ".ssh", "authorized_keys"), "utf8");

  it("rejects a non-key string", async () => {
    const r = await createSshService(home).authorizeKey("not a key");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("Invalid");
  });

  it("writes the key to authorized_keys", async () => {
    const r = await createSshService(home).authorizeKey(KEY_A);
    expect(r.ok).toBe(true);
    expect(authorized().trim()).toBe(KEY_A);
  });

  it("is idempotent for the same key (even with a different comment)", async () => {
    const svc = createSshService(home);
    await svc.authorizeKey(KEY_A);
    await svc.authorizeKey(KEY_A);
    await svc.authorizeKey(`${KEY_A.split(" ").slice(0, 2).join(" ")} renamed`);
    const lines = authorized().trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("appends distinct keys", async () => {
    const svc = createSshService(home);
    await svc.authorizeKey(KEY_A);
    await svc.authorizeKey(KEY_B);
    const lines = authorized().trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
