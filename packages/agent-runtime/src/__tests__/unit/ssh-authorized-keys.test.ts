import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  createSshService,
  sshDirFor,
  SSH_RUNTIME_DIR,
} from "../../modules/ssh.js";

// TEST_OVERVIEW: a VM agent whose storage is full is the one its owner has to get into to free space, and registering the CLI's key was the write it refused first: `mkdir '/home/agent/.ssh'` fails with ENOSPC. So sshd's own files take a directory of the runtime's, off the agent's home, and registering a key writes only there.

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample dam-cli-key";

describe("createSshService", () => {
  // TEST_SCENARIO: the key a connection registers lands in the directory the runtime names, which is created 0700 for it and is no directory of the agent's home that a full disk can refuse.
  it("registers the key outside the agent's home", async () => {
    const root = await mkdtemp(join(tmpdir(), "dam-ssh-"));
    const sshDir = join(root, "run", "ssh");
    const result = await createSshService(sshDir).authorizeKey(KEY);
    expect(result.ok).toBe(true);
    expect(await readFile(join(sshDir, "authorized_keys"), "utf8")).toContain(
      KEY,
    );
    expect((await stat(sshDir)).mode & 0o777).toBe(0o700);
    expect(SSH_RUNTIME_DIR).toBe("/run/dam/ssh");
  });

  // TEST_SCENARIO: the key a connection registers lands in the directory the runtime names only where the machine boots a VM, which is the case the whole fix turns on: choosing the home's directory again would restore the lockout a full home causes, and every test above would still pass, since they hand their own directory in. The choice is asserted here on both branches, and the server is asserted to make it through this function rather than spelling out a directory of its own.
  it("takes sshd's directory from the runtime's where the guest mounts the share", async () => {
    expect(sshDirFor(true, "/home/agent")).toBe(SSH_RUNTIME_DIR);
    expect(sshDirFor(false, "/home/agent")).toBe("/home/agent/.ssh");
    const server = await readFile(
      new URL("../../server.ts", import.meta.url),
      "utf8",
    );
    expect(server).toContain("sshDirFor(existsSync(VM_SHARE_DIR), homeDir)");
    expect(server).not.toContain('join(homeDir, ".ssh")');
  });

  // TEST_SCENARIO: a full home is the one the owner has to get into to free it, so a connection registers its key with the home's own directory refusing every write: the key lands in the runtime's directory, and nothing is written home.
  it.skipIf(process.getuid?.() === 0)(
    "registers a key while the home refuses a write",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "dam-ssh-"));
      const sshHome = join(root, "home", ".ssh");
      await mkdir(sshHome, { recursive: true });
      await chmod(sshHome, 0o500);
      const authorizedKeys = join(sshHome, "authorized_keys");
      await expect(writeFile(authorizedKeys, "")).rejects.toThrow();

      const sshDir = join(root, "run", "ssh");
      const result = await createSshService(sshDir).authorizeKey(KEY);
      await chmod(sshHome, 0o700);
      expect(result.ok).toBe(true);
      expect(await readFile(join(sshDir, "authorized_keys"), "utf8")).toContain(
        KEY,
      );
      await expect(stat(authorizedKeys)).rejects.toThrow();
    },
  );

  // TEST_SCENARIO: a directory the runtime may not write — a container's /run, where only root may — is reported to the caller as an error result, so the CLI names the refusal instead of the mutation rejecting with nothing to say.
  it.skipIf(process.getuid?.() === 0)(
    "reports a directory it cannot write",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "dam-ssh-"));
      const locked = join(root, "run");
      await mkdir(locked, { mode: 0o500 });
      const result = await createSshService(join(locked, "ssh")).authorizeKey(
        KEY,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("Unavailable");
    },
  );
});
