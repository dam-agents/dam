import { createBackoff, type BackoffOptions } from "./backoff.js";
import type {
  CompatService,
  ConfigService,
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../cli/index.js";
import { upgradeAdvice } from "../cli/infrastructure/npm-installer.js";
import { SERVER_ENV_VAR } from "../cli/index.js";
import { EXIT_BELOW_FLOOR, EXIT_RUNTIME_FAILURE } from "./exit-codes.js";
import { readHarnessMode } from "./harness-mode.js";

export interface ProbeRetry {
  onWait: (reason: string, delayMs: number) => void;
  backoff?: BackoffOptions;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The host a command talks to, after asking the
 * server which versions it accepts. A command that runs unattended asks with
 * `retry`: a worker is often started before its network is up, so an
 * unreachable server is waited out rather than exiting. Everything a wait cannot
 * change — a missing or malformed configuration, a server that answered with an
 * error, a version below the floor — ends the process as it does for every other
 * command, and the probe is asked once per attempt and never twice, so a drop
 * between two reads cannot end a service.
 */
export async function resolveActiveHost(
  deps: { compatService: CompatService; configService: ConfigService },
  server: string | undefined,
  retry?: ProbeRetry,
): Promise<string> {
  /* UNIT_BOUNDARY_DESCRIPTION: an assistant's CLI came from the install it talks to, so there is no floor to meet and no recommendation to chase — the harness base is the host, and no configured server is consulted. */
  const harness = readHarnessMode();
  if (harness !== null) return harness.baseUrl;
  const backoff =
    retry === undefined ? undefined : createBackoff(retry.backoff);
  for (;;) {
    const compat = await deps.compatService.check({
      flag: server ? { server } : undefined,
    });
    if (compat.ok) {
      if (compat.value.kind === "below-floor") {
        process.stderr.write(
          `error: CLI ${compat.value.localCli} is below the server's minimum required version ${compat.value.serverMinClient}; upgrade and retry\n`,
        );
        process.exit(EXIT_BELOW_FLOOR);
      }
      if (compat.value.kind === "behind-current") {
        process.stderr.write(
          `warning: CLI ${compat.value.localCli} is behind the server's recommended CLI ${compat.value.serverRecommendedClient}; ${upgradeAdvice(compat.value.serverRecommendedClient)}\n`,
        );
      }
      break;
    }
    if (
      retry !== undefined &&
      backoff !== undefined &&
      transient(compat.error)
    ) {
      const delay = backoff.next();
      retry.onWait(compat.error.message, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    printCompatError(compat.error);
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  return resolveHostFromConfig(deps, server);
}

function transient(
  e: MissingConfigError | MalformedConfigError | ProbeError,
): e is ProbeError {
  return (
    e.kind === "probe-error" && (e.code === "network" || e.code === "timeout")
  );
}

export async function resolveHostFromConfig(
  deps: { configService: ConfigService },
  server: string | undefined,
): Promise<string> {
  const cfg = await deps.configService.getResolved({
    flag: server ? { server } : undefined,
  });
  if (!cfg.ok) {
    printCompatError(cfg.error);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  return cfg.value.server;
}

function printCompatError(
  e: MissingConfigError | MalformedConfigError | ProbeError,
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run \`dam config set server <url>\` or set \`${SERVER_ENV_VAR}\`\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason}\n`);
      return;
    case "probe-error":
      process.stderr.write(`error: cannot reach server: ${e.message}\n`);
      return;
  }
}
