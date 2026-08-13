import { spawn } from "node:child_process";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";

const GH_TOKEN_ENV = "GH_TOKEN";
const SETUP_TIMEOUT_MS = 10_000;

export function configureGitCredentialHelper(
  envReader: RuntimeEnvReader,
  log: (msg: string) => void,
): void {
  const env = mergedSpawnEnv(envReader);
  if (!env[GH_TOKEN_ENV]) return;

  const proc = spawn("gh", ["auth", "setup-git"], {
    stdio: ["ignore", "ignore", "pipe"],
    env,
  });
  const stderr: Buffer[] = [];
  const timer = setTimeout(() => {
    proc.kill("SIGKILL");
    log(`gh auth setup-git timed out after ${SETUP_TIMEOUT_MS}ms`);
  }, SETUP_TIMEOUT_MS);
  proc.stderr?.on("data", (c: Buffer) => stderr.push(c));
  proc.on("error", (e) => {
    clearTimeout(timer);
    log(`gh auth setup-git failed: ${e.message}`);
  });
  proc.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0)
      log(
        `gh auth setup-git exited ${code}: ${Buffer.concat(stderr).toString().trim()}`,
      );
  });
}
