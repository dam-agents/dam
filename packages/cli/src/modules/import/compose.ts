import type { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { AgentService } from "../agent/index.js";
import { buildImportCommand } from "./commands/import.js";
import { createBundleBuilder } from "./infrastructure/bundle-builder.js";

export interface ImportModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host service factory exported by the agent module's compose. */
  createAgentService: (host: string) => AgentService;
  serverEnvVar: string;
}

export interface ImportModule {
  commands: ReadonlyArray<Command>;
}

/** Slimmer than `auth`/`agent` — one POST with status-classification
 *  doesn't earn a service layer. */
export function composeImportModule(opts: ImportModuleOptions): ImportModule {
  return {
    commands: [
      buildImportCommand({
        tokenProvider: opts.tokenProvider,
        compatService: opts.compatService,
        configService: opts.configService,
        createAgentService: opts.createAgentService,
        bundleBuilder: createBundleBuilder(),
        serverEnvVar: opts.serverEnvVar,
      }),
    ],
  };
}
