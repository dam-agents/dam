import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { InstanceService } from "../instance/index.js";
import { createTrpcClient } from "../shared/trpc/trpc-client.js";
import { createBearerSupplier } from "../shared/trpc/bearer-supplier.js";
import { buildChatCommand } from "./commands/chat.js";
import { buildSessionListCommand } from "./commands/session-list.js";
import { createConfirmModeSwitch } from "./infrastructure/confirm-mode-switch.js";
import { createChatService } from "./services/chat-service.js";
import { createSessionsPort } from "./services/sessions-service.js";

export function composeChatModule({
  compatService, configService, tokenProvider, createInstanceService,
}: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createInstanceService: (host: string) => InstanceService;
}): { commands: ReadonlyArray<Command> } {
  const buildSessionsPort = (host: string) =>
    createSessionsPort({ trpc: createTrpcClient({ host, getToken: createBearerSupplier(tokenProvider, host) }) });

  const chatService = createChatService({
    compatService, configService, tokenProvider, createInstanceService,
    createSessionsPort: buildSessionsPort,
    confirmModeSwitch: createConfirmModeSwitch(),
    isTty: Boolean(process.stdin.isTTY),
  });

  const sessionParent = new Command("session").description("Manage sessions for an Instance");
  sessionParent.addCommand(buildSessionListCommand({ chatService }), { isDefault: true });

  return {
    commands: [
      buildChatCommand({ chatService }),
      sessionParent,
    ],
  };
}
