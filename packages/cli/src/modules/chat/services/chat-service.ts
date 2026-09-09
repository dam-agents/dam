import type { SessionView } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TokenProvider } from "../../auth/index.js";
import type { AgentService } from "../../agent/index.js";
import { createBootstrap, type BootstrapError } from "./bootstrap.js";
import type { SessionsPort, TerminalStrategy } from "./sessions-service.js";
import {
  connectTerminalBridge,
  type BridgeResult,
} from "../infrastructure/terminal-bridge.js";

export type ChatError =
  | BootstrapError
  | { kind: "not-a-tty" }
  | { kind: "session-failed"; reason: string }
  | { kind: "mode-switch-declined" }
  | { kind: "no-terminal-session" }
  | { kind: "multiple-terminal-sessions"; sessionIds: string[] }
  | { kind: "session-not-found"; sessionId: string };

export interface ChatService {
  run(input: {
    agentRef: string;
    serverFlag?: string;
    strategy: TerminalStrategy;
    reset?: boolean;
  }): Promise<Result<{ bridge: BridgeResult; sessionId: string }, ChatError>>;
  listSessions(input: {
    agentRef: string;
    serverFlag?: string;
  }): Promise<Result<readonly SessionView[], ChatError>>;
}

export function createChatService(deps: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createAgentService: (host: string) => AgentService;
  createSessionsPort: (host: string, token: string) => SessionsPort;
  confirmModeSwitch: () => Promise<boolean>;
  isTty: boolean;
}): ChatService {
  const bare = createBootstrap(deps);
  async function bootstrap(agentRef: string, serverFlag?: string) {
    const ctx = await bare(agentRef, serverFlag);
    if (!ctx.ok) return ctx;
    return ok({
      ...ctx.value,
      sessions: deps.createSessionsPort(ctx.value.host, ctx.value.token),
    });
  }

  return {
    async listSessions(input) {
      const ctx = await bootstrap(input.agentRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const result = await ctx.value.sessions.list(ctx.value.agentId);
      if (!result.ok)
        return err({
          kind: "session-failed" as const,
          reason: result.error.reason,
        });
      return result;
    },

    async run(input) {
      if (!deps.isTty) return err({ kind: "not-a-tty" });

      const ctx = await bootstrap(input.agentRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const { host, token, agentId, sessions } = ctx.value;

      let resolution = await sessions.resolveTerminal(agentId, input.strategy, {
        reset: input.reset,
      });
      if (!resolution.ok)
        return err({
          kind: "session-failed" as const,
          reason: resolution.error.reason,
        });

      if (resolution.value.kind === "confirm-mode-switch") {
        if (!(await deps.confirmModeSwitch()))
          return err({ kind: "mode-switch-declined" });
        resolution = await sessions.resolveTerminal(
          agentId,
          { kind: "resume", sessionId: resolution.value.sessionId },
          { reset: input.reset, force: true },
        );
        if (!resolution.ok)
          return err({
            kind: "session-failed" as const,
            reason: resolution.error.reason,
          });
      }

      const r = resolution.value;
      if (r.kind === "confirm-mode-switch")
        return err({
          kind: "session-failed" as const,
          reason: "unexpected mode-switch prompt",
        });
      if (r.kind !== "ready") return err(r);

      const bridge = await connectTerminalBridge({
        host,
        token,
        terminalPath: r.terminalPath,
        stdin: process.stdin as NodeJS.ReadStream & {
          setRawMode(mode: boolean): void;
        },
        stdout: process.stdout,
      });

      return ok({ bridge, sessionId: r.sessionId });
    },
  };
}
