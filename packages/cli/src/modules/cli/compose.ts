import type { Command } from "commander";
import { buildConfigSetCommand } from "./commands/config-set.js";
import { buildPingCommand } from "./commands/ping.js";
import { buildVersionCommand } from "./commands/version.js";
import { defaultConfigPath } from "./infrastructure/config-path.js";
import { createTomlConfigStore } from "./infrastructure/config-store.js";
import { createProcessEnvReader } from "./infrastructure/env-reader.js";
import { readPackageVersion } from "./infrastructure/package-version.js";
import { createHttpVersionProbe } from "./infrastructure/version-probe.js";
import {
  createCompatService,
  type CompatService,
} from "./services/compat-service.js";
import {
  createConfigService,
  type ConfigService,
} from "./services/config-service.js";

export interface CliModuleOptions {
  /** Override for the production config path (resolved via XDG —
   *  `$XDG_CONFIG_HOME/dam/config.toml`, default `~/.config/dam/config.toml`).
   *  Used by integration tests; defaults to the real path otherwise. */
  configPath?: string;
}

export interface CliModule {
  commands: ReadonlyArray<Command>;
  services: {
    compatService: CompatService;
    configService: ConfigService;
  };
  cliVersion: string;
}

const SERVER_ENV_VAR = "DAM_SERVER";

/**
 * Wires the cli module — config-set, ping, version — and exposes the
 * services other modules (e.g. `auth`) consume across the
 * `cli/index.ts` seam. Does NOT create the commander program; the
 * package-level `compose()` owns that.
 */
export function composeCliModule(opts: CliModuleOptions = {}): CliModule {
  const configPath = opts.configPath ?? defaultConfigPath();
  const store = createTomlConfigStore(configPath);
  const envReader = createProcessEnvReader();
  const cliVersion = readPackageVersion();

  const configService = createConfigService({
    store,
    envReader,
    envVars: { server: SERVER_ENV_VAR },
  });

  const compatService = createCompatService({
    config: configService,
    probe: createHttpVersionProbe(),
    localCliVersion: cliVersion,
  });

  const commands: Command[] = [
    buildConfigSetCommand({ service: configService, configPath }),
    buildPingCommand({
      service: compatService,
      configService,
      serverEnvVar: SERVER_ENV_VAR,
    }),
    buildVersionCommand({ service: compatService, localCliVersion: cliVersion }),
  ];

  return {
    commands,
    services: { compatService, configService },
    cliVersion,
  };
}
