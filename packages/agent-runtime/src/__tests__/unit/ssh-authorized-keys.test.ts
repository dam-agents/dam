import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createSshService, SSH_RUNTIME_DIR } from "../../modules/ssh.js";

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
});
