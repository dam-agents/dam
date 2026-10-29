import { createInterface } from "node:readline";
import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { AgentService } from "../agent/index.js";
import { startFailure } from "../agent/commands/wait-or-exit.js";
import { buildChatCommand } from "./commands/chat.js";
import { buildRunCommand, trackStdout } from "./commands/run.js";
import { buildSessionListCommand } from "./commands/session-list.js";
import { buildSessionShowCommand } from "./commands/session-show.js";
import { createAcpSessionClient } from "./infrastructure/acp-session-client.js";
import { createBootstrap } from "./services/bootstrap.js";
import { createChatService } from "./services/chat-service.js";
import { createRunService } from "./services/run-service.js";
import { createSessionShowService } from "./services/session-show-service.js";
import { createSessionsPort } from "./services/sessions-service.js";

export const buildSessionsPort = (host: string, token: string) =>
  createSessionsPort({ acp: createAcpSessionClient({ host, token }) });

export function askModeSwitch(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    output.write(
      "Switch session mode\nSwitch this session to terminal mode? Files and history are preserved,\nbut any running tasks will be cancelled.\n",
    );
    rl.on("close", () => resolve(false));
    rl.question("[y/N] ", (answer) => {
      resolve(answer.trim().toLowerCase() === "y");
      rl.close();
    });
  });
}

export const ATTACH_PAUSE_MS = 5000;

export function pauseBeforeAttach(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  ms: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    let connect = true;
    const timer = setTimeout(() => {
      output.write("\n");
      rl.close();
    }, ms);
    rl.on("SIGINT", () => {
      connect = false;
      output.write("\n");
      rl.close();
    });
    rl.on("close", () => {
      clearTimeout(timer);
      resolve(connect);
    });
    rl.question(
      `Press Enter to connect, or wait ${Math.round(ms / 1000)} s. `,
      () => rl.close(),
    );
  });
}

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
    confirmModeSwitch: () => askModeSwitch(process.stdin, process.stderr),
    isTty: Boolean(process.stdin.isTTY),
  });

  const bootstrap = createBootstrap({
    compatService,
    configService,
    tokenProvider,
    createAgentService,
  });

  const runService = createRunService({
    bootstrap,
    out: trackStdout,
    errOut: (line) => process.stderr.write(`${line}\n`),
    onInterrupt: (handler) => {
      process.once("SIGINT", handler);
      return () => process.removeListener("SIGINT", handler);
    },
    whyNotStarted: (ctx) =>
      startFailure(createAgentService(ctx.host), ctx.agentId),
  });

  const sessionParent = new Command("session").description(
    "Manage sessions for an Agent",
  );
  sessionParent.addCommand(buildSessionListCommand({ chatService }), {
    isDefault: true,
  });
  sessionParent.addCommand(
    buildSessionShowCommand({
      sessionShowService: createSessionShowService({ bootstrap }),
      onInterrupt: (handler) => process.once("SIGINT", handler),
    }),
  );

  return {
    commands: [
      buildChatCommand({
        chatService,
        pause: () =>
          pauseBeforeAttach(process.stdin, process.stderr, ATTACH_PAUSE_MS),
      }),
      buildRunCommand({ runService }),
      sessionParent,
    ],
  };
}
