import { createInterface } from "node:readline";
import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { AgentService } from "../agent/index.js";
import { buildChatCommand } from "./commands/chat.js";
import { buildSessionListCommand } from "./commands/session-list.js";
import { createAcpSessionClient } from "./infrastructure/acp-session-client.js";
import { createChatService } from "./services/chat-service.js";
import { createSessionsPort } from "./services/sessions-service.js";

// Sessions are agent-owned: the port talks ACP to the agent over
// the api-server relay, not tRPC. Also used by the metrics module
// to join session titles onto metrics rows.
export const buildSessionsPort = (host: string, token: string) =>
  createSessionsPort({ acp: createAcpSessionClient({ host, token }) });

export function composeChatModule({
  compatService,
  configService,
  tokenProvider,
  createAgentService,
}: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createAgentService: (host: string) => AgentService;
}): { commands: ReadonlyArray<Command> } {
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
