import type { Command } from "commander";
import { buildConfigSetCommand } from "./commands/config-set.js";
import { buildPingCommand } from "./commands/ping.js";
import { buildUpdateCommand } from "./commands/update.js";
import { buildVersionCommand } from "./commands/version.js";
import { defaultConfigPath } from "./infrastructure/config-path.js";
import { createTomlConfigStore } from "./infrastructure/config-store.js";
import { createProcessEnvReader } from "./infrastructure/env-reader.js";
import {
  createHttpNpmLatestProbe,
  DEFAULT_NPM_REGISTRY,
} from "./infrastructure/npm-latest-probe.js";
import { createNpmInstaller } from "./infrastructure/npm-installer.js";
import { createHttpVersionProbe } from "./infrastructure/version-probe.js";
import { readHarnessMode } from "../shared/harness-mode.js";
import { SERVER_ENV_VAR } from "./domain/config.js";
import {
  createCompatService,
  type CompatService,
} from "./services/compat-service.js";
import {
  createConfigService,
  type ConfigService,
} from "./services/config-service.js";
import { createUpdateService } from "./services/update-service.js";

declare const __CLI_VERSION__: string | undefined;

const NPM_REGISTRY_ENV_VAR = "npm_config_registry";

export interface CliModule {
  commands: ReadonlyArray<Command>;
  services: { compatService: CompatService; configService: ConfigService };
  cliVersion: string;
}

export function composeCliModule(): CliModule {
  const configPath = defaultConfigPath();
  const store = createTomlConfigStore(configPath);
  const harness = readHarnessMode();
  const processEnv = createProcessEnvReader();
  /* UNIT_BOUNDARY_DESCRIPTION: inside an assistant there is no configured server to find — the install's own harness base is where every call goes, so it stands in for `DAM_SERVER` and nothing is read from the user's config file. */
  const envReader = {
    get: (name: string) =>
      name === SERVER_ENV_VAR && harness !== null
        ? harness.baseUrl
        : processEnv.get(name),
  };
  const cliVersion =
    typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev";

  const configService = createConfigService({ store, envReader });
  const compatService = createCompatService({
    config: configService,
    probe: createHttpVersionProbe(),
    localCliVersion: cliVersion,
  });
  const npmLatest = createHttpNpmLatestProbe({
    registry: envReader.get(NPM_REGISTRY_ENV_VAR) ?? DEFAULT_NPM_REGISTRY,
  });

  return {
    commands: [
      buildConfigSetCommand({ service: configService, configPath }),
      buildPingCommand({ service: compatService, configService }),
      buildVersionCommand({
        service: compatService,
        npm: npmLatest,
        localCliVersion: cliVersion,
      }),
      buildUpdateCommand({
        service: createUpdateService({
          latest: npmLatest,
          installer: createNpmInstaller(),
          localCliVersion: cliVersion,
        }),
      }),
    ],
    services: { compatService, configService },
    cliVersion,
  };
}
