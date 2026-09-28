import type { Command } from "commander";
import { buildConfigSetCommand } from "./commands/config-set.js";
import { buildPingCommand } from "./commands/ping.js";
import { buildVersionCommand } from "./commands/version.js";
import { defaultConfigPath } from "./infrastructure/config-path.js";
import { createTomlConfigStore } from "./infrastructure/config-store.js";
import { createProcessEnvReader } from "./infrastructure/env-reader.js";
import { createHttpVersionProbe } from "./infrastructure/version-probe.js";
import {
  createCompatService,
  type CompatService,
} from "./services/compat-service.js";
import {
  createConfigService,
  type ConfigService,
} from "./services/config-service.js";

declare const __CLI_VERSION__: string | undefined;

export interface CliModule {
  commands: ReadonlyArray<Command>;
  services: { compatService: CompatService; configService: ConfigService };
  cliVersion: string;
}

export function composeCliModule(): CliModule {
  const configPath = defaultConfigPath();
  const store = createTomlConfigStore(configPath);
  const envReader = createProcessEnvReader();
  const cliVersion =
    typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev";

  const configService = createConfigService({ store, envReader });
  const compatService = createCompatService({
    config: configService,
    probe: createHttpVersionProbe(),
    localCliVersion: cliVersion,
  });

  return {
    commands: [
      buildConfigSetCommand({ service: configService, configPath }),
      buildPingCommand({ service: compatService, configService }),
      buildVersionCommand({
        service: compatService,
        localCliVersion: cliVersion,
      }),
    ],
    services: { compatService, configService },
    cliVersion,
  };
}
