import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, chmod, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

export function defaultEditorKeysDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "dam", "editor-keys");
  return join(homedir(), ".local", "state", "dam", "editor-keys");
}

export function editorKeyPath(
  instanceName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(defaultEditorKeysDir(env), `${instanceName}.pem`);
}

export async function generateEditorKey(
  instanceName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ privateKeyPath: string; publicKey: string }> {
  const privateKeyPath = editorKeyPath(instanceName, env);
  const publicKeyPath = `${privateKeyPath}.pub`;
  await mkdir(dirname(privateKeyPath), { recursive: true, mode: 0o700 });
  await rm(privateKeyPath, { force: true });
  await rm(publicKeyPath, { force: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ssh-keygen",
      [
        "-t",
        "ed25519",
        "-f",
        privateKeyPath,
        "-N",
        "",
        "-q",
        "-C",
        `dam-editor-${instanceName}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ssh-keygen exited ${code}: ${err}`));
    });
  });

  await chmod(privateKeyPath, 0o600);
  const publicKey = (await readFile(publicKeyPath, "utf8")).trim();
  return { privateKeyPath, publicKey };
}
