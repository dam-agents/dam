import { Command } from "commander";
import { SERVER_ENV_VAR } from "../domain/config.js";
import type {
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../domain/errors.js";
import type { CompatService } from "../services/compat-service.js";
import type { ConfigService } from "../services/config-service.js";
import { EXIT_COMPAT_BELOW_FLOOR, EXIT_RUNTIME_FAILURE } from "./exit-codes.js";

export function buildPingCommand(deps: {
  service: CompatService;
  configService: ConfigService;
}): Command {
  return new Command("ping")
    .description("Reach the configured Platform server and check compatibility")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .action(async (opts: { server?: string }) => {
      const flag = opts.server ? { server: opts.server } : undefined;

      const cfg = await deps.configService.getResolved({ flag });
      if (!cfg.ok) {
        printResolveError(cfg.error, "");
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const host = cfg.value.server;

      const result = await deps.service.check({ flag });
      if (!result.ok) {
        printResolveError(result.error, host);
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
    case "probe-error": {
      const desc =
        e.code === "network"
          ? `cannot reach server \`${host}\`: ${e.message}`
          : e.code === "timeout"
            ? `server \`${host}\` did not respond in time: ${e.message}`
            : e.code === "non-ok-status"
              ? `server \`${host}\` returned ${e.message}`
              : `server \`${host}\` returned unexpected response: ${e.message}`;
      process.stderr.write(`error: ${desc}\n`);
      return;
    }
  }
}
