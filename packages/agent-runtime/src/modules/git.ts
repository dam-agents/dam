import { spawn } from "node:child_process";
import type { RuntimeEnvReader } from "../core/runtime-env.js";

const GH_TOKEN_ENV = "GH_TOKEN";
const SETUP_TIMEOUT_MS = 10_000;

// Point git's credential helper at `gh auth git-credential`: git hands the
// GH_TOKEN sentinel to the Envoy sidecar, which swaps it for the real token on
// the wire (same path REST uses). gh only treats github.com as authenticated
// when GH_TOKEN is in its env, and env is runtime-delivered (not pod env), so
// this runs as an env-change reaction — never at boot, where it always failed.
// Idempotent; fire-and-forget + bounded so a slow gh can't stall the env
// reaction, and a failure just leaves git unconfigured (private-repo ops would
// then prompt) rather than wedging anything.
export function configureGitCredentialHelper(
  envReader: RuntimeEnvReader,
  log: (msg: string) => void,
): void {
  const env = { ...envReader.current(), ...process.env };
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
