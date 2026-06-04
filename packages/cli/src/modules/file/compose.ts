import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { AgentService } from "../agent/index.js";
import { buildFileGetCommand } from "./commands/get.js";
import { buildFileListCommand } from "./commands/list.js";
import { buildFilePutCommand } from "./commands/put.js";

export interface FileModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export interface FileModule {
  commands: ReadonlyArray<Command>;
}

/** Slim module like `import` — three commands, each a single tRPC call
 *  against the per-agent proxy. No service layer. */
export function composeFileModule(opts: FileModuleOptions): FileModule {
  const parent = new Command("file").description(
    "Read, write, and list files in an Agent's workspace",
  );
  parent.addCommand(buildFileListCommand(opts));
  parent.addCommand(buildFileGetCommand(opts));
  parent.addCommand(buildFilePutCommand(opts));
  return { commands: [parent] };
}
