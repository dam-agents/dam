import type {
  CompatService,
  ConfigService,
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../cli/index.js";
import { SERVER_ENV_VAR } from "../cli/index.js";
import { EXIT_BELOW_FLOOR, EXIT_RUNTIME_FAILURE } from "./exit-codes.js";

export async function resolveActiveHost(
  deps: { compatService: CompatService; configService: ConfigService },
  server: string | undefined,
): Promise<string> {
  const compat = await deps.compatService.check({
    flag: server ? { server } : undefined,
  });
  if (!compat.ok) {
    printCompatError(compat.error);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  if (compat.value.kind === "below-floor") {
    process.stderr.write(
      `error: CLI ${compat.value.localCli} is below the server's minimum required version ${compat.value.serverMinClient}; upgrade and retry\n`,
    );
    process.exit(EXIT_BELOW_FLOOR);
  }
  if (compat.value.kind === "behind-current") {
    process.stderr.write(
      `warning: CLI ${compat.value.localCli} is behind server ${compat.value.serverVersion}; consider upgrading\n`,
    );
  }

  return resolveHostFromConfig(deps, server);
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
