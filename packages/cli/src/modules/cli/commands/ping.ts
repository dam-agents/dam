import { Command } from "commander";
import type {
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../domain/errors.js";
import type { CompatService } from "../services/compat-service.js";
import type { ConfigService } from "../services/config-service.js";
import {
  EXIT_COMPAT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
} from "./exit-codes.js";

export interface PingCommandDeps {
  service: CompatService;
  /** Used to resolve the Active Host up-front so probe failures can carry
   *  it in the user-facing message. */
  configService: ConfigService;
  /** Env var name for the server URL — surfaced verbatim in the
   *  `no server configured` setup hint. */
  serverEnvVar: string;
}

export function buildPingCommand(deps: PingCommandDeps): Command {
  return new Command("ping")
    .description("Reach the configured Platform server and check compatibility")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .action(async (opts: { server?: string }) => {
      const flag = opts.server ? { server: opts.server } : undefined;

      // Resolve the host first so probe failures can include it.
      // missing-config / malformed-config short-circuit before we hit the
      // wire; they don't have a host anyway.
      const cfg = await deps.configService.getResolved({ flag });
      if (!cfg.ok) {
        printResolveError(cfg.error, "", deps.serverEnvVar);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const host = cfg.value.server;

      const result = await deps.service.check({ flag });

      if (!result.ok) {
        printResolveError(result.error, host, deps.serverEnvVar);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      const verdict = result.value;
      switch (verdict.kind) {
        case "ok":
          process.stdout.write(`ok — server ${verdict.serverVersion}\n`);
          return;
        case "behind-current":
          process.stderr.write(
            `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
          );
          process.stdout.write(`ok — server ${verdict.serverVersion}\n`);
          return;
        case "below-floor":
          process.stderr.write(
            `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry\n`,
          );
          process.exit(EXIT_COMPAT_BELOW_FLOOR);
      }
    });
}

function printResolveError(
  e: MissingConfigError | MalformedConfigError | ProbeError,
  host: string,
  serverEnvVar: string,
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run \`dam config set server <url>\` or set \`${serverEnvVar}\`\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason}\n`);
      return;
    case "probe-error":
      process.stderr.write(`error: ${describeProbeError(e, host)}\n`);
      return;
  }
}

function describeProbeError(e: ProbeError, host: string): string {
  switch (e.code) {
    case "network":
      return `cannot reach server \`${host}\`: ${e.message}`;
    case "timeout":
      return `server \`${host}\` did not respond in time: ${e.message}`;
    case "non-ok-status":
      return `server \`${host}\` returned ${e.message}`;
    case "malformed-response":
      return `server \`${host}\` returned unexpected response: ${e.message}`;
  }
}
