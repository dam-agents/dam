import type { Contribution } from "agent-runtime-api";
import {
  mergedSpawnEnv,
  type RuntimeEnvReader,
} from "../../core/runtime-env.js";
import {
  describeFailure,
  runOnce,
  type RunOnceOptions,
  type RunOnceResult,
} from "../../core/run-once.js";

const GH_TOKEN_ENV = "GH_TOKEN";
const GH_ENTERPRISE_TOKEN_ENV = "GH_ENTERPRISE_TOKEN";
const GH_AVAILABLE_ENV = "PLATFORM_GH_TOKEN_AVAILABLE";
const GH_HOSTS_FILE_PATH = "$HOME/.config/gh/hosts.yml";
const SETUP_TIMEOUT_MS = 10_000;
const SETUP_COMMAND = ["gh", "auth", "setup-git"];

export type GitCredentialHelperSetup = (
  contributions: readonly Contribution[],
) => void;

function ghCredentialFingerprint(
  contributions: readonly Contribution[],
): string {
  const relevant = contributions.filter(
    (c) =>
      (c.kind === "env" &&
        (c.name === GH_TOKEN_ENV ||
          c.name === GH_ENTERPRISE_TOKEN_ENV ||
          c.name === GH_AVAILABLE_ENV)) ||
      (c.kind === "file" && c.path === GH_HOSTS_FILE_PATH),
  );
  return relevant.length === 0 ? "" : JSON.stringify(relevant);
}

export function createGitCredentialHelperSetup(
  envReader: RuntimeEnvReader,
  log: (msg: string) => void,
  run: (opts: RunOnceOptions) => Promise<RunOnceResult> = runOnce,
): GitCredentialHelperSetup {
  let configuredFor = "";
  let queue: Promise<void> = Promise.resolve();
  return (contributions) => {
    const fingerprint = ghCredentialFingerprint(contributions);
    if (fingerprint === "" || fingerprint === configuredFor) return;
    configuredFor = fingerprint;
    queue = queue.then(async () => {
      const result = await run({
        command: SETUP_COMMAND,
        timeoutMs: SETUP_TIMEOUT_MS,
        env: mergedSpawnEnv(envReader),
      });
      if (!result.ok) {
        if (configuredFor === fingerprint) configuredFor = "";
        log(describeFailure(SETUP_COMMAND.join(" "), result.error));
      }
    });
  };
}
