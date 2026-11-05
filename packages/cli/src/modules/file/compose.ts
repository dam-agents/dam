import { Command } from "commander";
import { refuseInHarnessMode } from "../shared/harness-mode.js";
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

export function composeFileModule(opts: FileModuleOptions): FileModule {
  const parent = new Command("file").description(
    "Read, write, and list files in an Agent's workspace",
  );
  // UNIT_BOUNDARY_DESCRIPTION: an agent's files are read and written over the owner's own door, not over the assistant's path.
  parent.hook("preAction", () => refuseInHarnessMode("file"));
  parent.addCommand(buildFileListCommand(opts));
  parent.addCommand(buildFileGetCommand(opts));
  parent.addCommand(buildFilePutCommand(opts));
  return { commands: [parent] };
}
