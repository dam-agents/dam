import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";
import { describeFailure, runOnce } from "../core/run-once.js";

const GH_TOKEN_ENV = "GH_TOKEN";
const SETUP_TIMEOUT_MS = 10_000;
const SETUP_COMMAND = ["gh", "auth", "setup-git"];

export function configureGitCredentialHelper(
  envReader: RuntimeEnvReader,
  log: (msg: string) => void,
): void {
  const env = mergedSpawnEnv(envReader);
  if (!env[GH_TOKEN_ENV]) return;

  void runOnce({
    command: SETUP_COMMAND,
    timeoutMs: SETUP_TIMEOUT_MS,
    env,
  }).then((result) => {
    if (!result.ok) log(describeFailure(SETUP_COMMAND, result.error));
  });
}
