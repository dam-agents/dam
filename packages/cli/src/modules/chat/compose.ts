import { createInterface } from "node:readline";
import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { AgentService } from "../agent/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildChatCommand } from "./commands/chat.js";
import { buildSessionListCommand } from "./commands/session-list.js";
import { createChatService } from "./services/chat-service.js";
import { createSessionsPort } from "./services/sessions-service.js";

export function composeChatModule({
  compatService,
  configService,
  tokenProvider,
  buildTrpc,
  createAgentService,
}: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  buildTrpc: (host: string) => TrpcClient;
  createAgentService: (host: string) => AgentService;
}): { commands: ReadonlyArray<Command> } {
  const buildSessionsPort = (host: string) =>
    createSessionsPort({ trpc: buildTrpc(host) });

  const chatService = createChatService({
    compatService,
    configService,
    tokenProvider,
    createAgentService,
    createSessionsPort: buildSessionsPort,
    confirmModeSwitch: () =>
      new Promise((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        process.stderr.write(
          "Switch session mode\nSwitch this session to terminal mode? Files and history are preserved,\nbut any running tasks will be cancelled.\n",
        );
        rl.question("[y/N] ", (answer) => {
          rl.close();
          resolve(answer.trim().toLowerCase() === "y");
        });
      }),
    isTty: Boolean(process.stdin.isTTY),
  });

  const sessionParent = new Command("session").description(
    "Manage sessions for an Agent",
  );
  sessionParent.addCommand(buildSessionListCommand({ chatService }), {
    isDefault: true,
  });

  return {
    commands: [buildChatCommand({ chatService }), sessionParent],
  };
}
