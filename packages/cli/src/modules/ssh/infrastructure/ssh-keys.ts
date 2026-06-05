import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SshPaths {
  dir: string;
  privateKey: string;
  publicKey: string;
}

export function sshPaths(env: NodeJS.ProcessEnv = process.env): SshPaths {
  const xdg = env.XDG_STATE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "state");
  const dir = join(base, "dam", "ssh");
  return {
    dir,
    privateKey: join(dir, "id_ed25519"),
    publicKey: join(dir, "id_ed25519.pub"),
  };
}

export async function ensureKeyPair(paths: SshPaths): Promise<string> {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  if (!existsSync(paths.privateKey)) {
    const r = spawnSync(
      "ssh-keygen",
      [
        "-t",
        "ed25519",
        "-f",
        paths.privateKey,
        "-N",
        "",
        "-q",
        "-C",
        "dam-cli",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    if (r.error)
      throw new Error(
        `ssh-keygen not available (${r.error.message}); install OpenSSH`,
      );
    if (r.status !== 0)
      throw new Error(
        `ssh-keygen failed: ${r.stderr?.toString().trim() || `exit ${r.status}`}`,
      );
  }
  return (await readFile(paths.publicKey, "utf8")).trim();
}
