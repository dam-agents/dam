import { Command } from "commander";
import { buildConfigSetCommand } from "./commands/config-set.js";
import { defaultConfigPath } from "./infrastructure/config-path.js";
import { createTomlConfigStore } from "./infrastructure/config-store.js";
import { createProcessEnvReader } from "./infrastructure/env-reader.js";
import { readPackageVersion } from "./infrastructure/package-version.js";
import { createConfigService } from "./services/config-service.js";

export interface ComposeOptions {
  /** Override for the production `${HOME}/.dam/config.toml` location.
   *  Used by integration tests; defaults to the real path otherwise. */
  configPath?: string;
}

export function compose(opts: ComposeOptions = {}): Command {
  const configPath = opts.configPath ?? defaultConfigPath();
  const store = createTomlConfigStore(configPath);
  const envReader = createProcessEnvReader();

  const configService = createConfigService({
    store,
    envReader,
    envVars: { server: "DAM_SERVER" },
  });

  const program = new Command();
  program
    .name("dam")
    .description("Command-line client for a Platform deployment")
    .version(readPackageVersion());

  program.addCommand(buildConfigSetCommand({ service: configService, configPath }));

  return program;
}
