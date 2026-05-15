import type { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { InstanceService } from "../instance/index.js";
import { buildImportCommand } from "./commands/import.js";
import { createBundleBuilder } from "./infrastructure/bundle-builder.js";

export interface ImportModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host service factory exported by the instance module's compose. */
  createInstanceService: (host: string) => InstanceService;
  serverEnvVar: string;
}

export interface ImportModule {
  commands: ReadonlyArray<Command>;
}

/** Slimmer than `auth`/`instance` — one POST with status-classification
 *  doesn't earn a service layer. */
export function composeImportModule(opts: ImportModuleOptions): ImportModule {
  return {
    commands: [
      buildImportCommand({
        tokenProvider: opts.tokenProvider,
        compatService: opts.compatService,
        configService: opts.configService,
        createInstanceService: opts.createInstanceService,
        bundleBuilder: createBundleBuilder(),
        serverEnvVar: opts.serverEnvVar,
      }),
    ],
  };
}
