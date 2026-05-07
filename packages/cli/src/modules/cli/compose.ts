import { Command } from "commander";
import { buildConfigSetCommand } from "./commands/config-set.js";
import { buildPingCommand } from "./commands/ping.js";
import { buildVersionCommand } from "./commands/version.js";
import { defaultConfigPath } from "./infrastructure/config-path.js";
import { createTomlConfigStore } from "./infrastructure/config-store.js";
import { createProcessEnvReader } from "./infrastructure/env-reader.js";
import { readPackageVersion } from "./infrastructure/package-version.js";
import { createHttpVersionProbe } from "./infrastructure/version-probe.js";
import { createCompatService } from "./services/compat-service.js";
import { createConfigService } from "./services/config-service.js";

export interface ComposeOptions {
  /** Override for the production config path (resolved via XDG —
   *  `$XDG_CONFIG_HOME/dam/config.toml`, default `~/.config/dam/config.toml`).
   *  Used by integration tests; defaults to the real path otherwise. */
  configPath?: string;
}

const SERVER_ENV_VAR = "DAM_SERVER";

export function compose(opts: ComposeOptions = {}): Command {
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

  const program = new Command();
  program
    .name("dam")
    .description("Command-line client for a Platform deployment")
    .version(cliVersion);

  program.addCommand(
    buildConfigSetCommand({ service: configService, configPath }),
  );
  program.addCommand(
    buildPingCommand({ service: compatService, serverEnvVar: SERVER_ENV_VAR }),
  );
  program.addCommand(
    buildVersionCommand({ service: compatService, localCliVersion: cliVersion }),
  );

  return program;
}
