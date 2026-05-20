import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { InstanceService } from "../instance/index.js";
import { buildEditorCommand } from "./commands/editor.js";

export function composeEditorModule({
  compatService,
  configService,
  tokenProvider,
  createInstanceService,
}: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createInstanceService: (host: string) => InstanceService;
}): { commands: ReadonlyArray<Command> } {
  return {
    commands: [
      buildEditorCommand({
        compatService,
        configService,
        tokenProvider,
        createInstanceService,
      }),
    ],
  };
}
