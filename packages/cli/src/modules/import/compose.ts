import type { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { InstanceResolver } from "../instances/index.js";
import { buildImportCommand } from "./commands/import.js";
import { createBundleBuilder } from "./infrastructure/bundle-builder.js";

export interface ImportModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host resolver factory exported by the instances module. */
  createInstanceResolver: (host: string) => InstanceResolver;
  serverEnvVar: string;
}

export interface ImportModule {
  commands: ReadonlyArray<Command>;
}

/**
 * Wires the `import` verb. Slimmer than `auth`/`instances` — one POST
 * with status-classification doesn't justify a service layer.
 */
export function composeImportModule(opts: ImportModuleOptions): ImportModule {
  return {
    commands: [
      buildImportCommand({
        tokenProvider: opts.tokenProvider,
        compatService: opts.compatService,
        configService: opts.configService,
        createInstanceResolver: opts.createInstanceResolver,
        bundleBuilder: createBundleBuilder(),
        serverEnvVar: opts.serverEnvVar,
      }),
    ],
  };
}
