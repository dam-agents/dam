import type { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { AgentService } from "../agent/index.js";
import { buildImportCommand } from "./commands/import.js";
import { createBundleBuilder } from "./infrastructure/bundle-builder.js";
import { refuseInHarnessMode } from "../shared/harness-mode.js";

export interface ImportModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export interface ImportModule {
  commands: ReadonlyArray<Command>;
}

export function composeImportModule(opts: ImportModuleOptions): ImportModule {
  const command = buildImportCommand({
    tokenProvider: opts.tokenProvider,
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    bundleBuilder: createBundleBuilder(),
  });
  // UNIT_BOUNDARY_DESCRIPTION: an import writes straight into an agent's workspace through the owner's own door.
  command.hook("preAction", () => refuseInHarnessMode("import"));
  return { commands: [command] };
}
