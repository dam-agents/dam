import { Command } from "commander";
import type {
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../domain/errors.js";
import type { CompatService } from "../services/compat-service.js";
import {
  EXIT_COMPAT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
} from "./exit-codes.js";

export interface PingCommandDeps {
  service: CompatService;
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
      const result = await deps.service.check({
        flag: opts.server ? { server: opts.server } : undefined,
      });

      if (!result.ok) {
        printResolveError(result.error, deps.serverEnvVar);
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
  serverEnvVar: string,
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run "dam config set server <url>" or set ${serverEnvVar}\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason}\n`);
      return;
    case "probe-error":
      process.stderr.write(`error: ${describeProbeError(e)}\n`);
      return;
  }
}

function describeProbeError(e: ProbeError): string {
  switch (e.code) {
    case "network":
      return `cannot reach server: ${e.message}`;
    case "timeout":
      return `server did not respond in time: ${e.message}`;
    case "non-ok-status":
      return `server returned ${e.message}`;
    case "malformed-response":
      return `server returned unexpected response: ${e.message}`;
  }
}
