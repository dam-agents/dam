import type {
  CompatService,
  Config,
  ConfigService,
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../cli/index.js";
import { SERVER_ENV_VAR } from "../cli/index.js";

export async function resolveActiveHost(
  deps: { compatService: CompatService; configService: ConfigService },
  opts: {
    flag?: Partial<Config>;
    exitCodes: { runtimeFailure: number; belowFloor: number };
  },
): Promise<string> {
  const compat = await deps.compatService.check({ flag: opts.flag });
  if (!compat.ok) {
    printCompatError(compat.error);
    process.exit(opts.exitCodes.runtimeFailure);
  }
  if (compat.value.kind === "below-floor") {
    process.stderr.write(
      `error: CLI ${compat.value.localCli} is below the server's minimum required version ${compat.value.serverMinClient}; upgrade and retry\n`,
    );
    process.exit(opts.exitCodes.belowFloor);
  }
  if (compat.value.kind === "behind-current") {
    process.stderr.write(
      `warning: CLI ${compat.value.localCli} is behind server ${compat.value.serverVersion}; consider upgrading\n`,
    );
  }

  return resolveHostFromConfig(deps, {
    flag: opts.flag,
    exitCodes: { runtimeFailure: opts.exitCodes.runtimeFailure },
  });
}

export async function resolveHostFromConfig(
  deps: { configService: ConfigService },
  opts: { flag?: Partial<Config>; exitCodes: { runtimeFailure: number } },
): Promise<string> {
  const cfg = await deps.configService.getResolved({ flag: opts.flag });
  if (!cfg.ok) {
    printConfigError(cfg.error);
    process.exit(opts.exitCodes.runtimeFailure);
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

function printConfigError(e: MissingConfigError | MalformedConfigError): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run \`dam config set server <url>\` or set \`${SERVER_ENV_VAR}\`\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason}\n`);
      return;
  }
}
