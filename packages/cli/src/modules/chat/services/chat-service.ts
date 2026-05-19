import type { SessionView, TerminalStrategy } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TokenProvider } from "../../auth/index.js";
import {
  createAgentResolver,
  type AgentService,
  type ResolveError,
} from "../../agent/index.js";
import type { SessionsPort } from "./sessions-service.js";
import {
  connectTerminalBridge,
  type BridgeResult,
} from "../infrastructure/terminal-bridge.js";

export type ChatError =
  | ResolveError
  | { kind: "no-server" }
  | { kind: "malformed-config"; reason: string }
  | { kind: "below-floor"; localCli: string; serverMinClient: string }
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
  createSessionsPort: (host: string) => SessionsPort;
  confirmModeSwitch: () => Promise<boolean>;
  isTty: boolean;
}): ChatService {
  async function bootstrap(agentRef: string, serverFlag?: string) {
    const flag = serverFlag ? { server: serverFlag } : undefined;
    const config = await deps.configService.getResolved({ flag });
    if (!config.ok) {
      return config.error.kind === "malformed-config"
        ? err({
            kind: "malformed-config" as const,
            reason: config.error.reason,
          })
        : err({ kind: "no-server" as const });
    }
    const host = config.value.server;

    const compat = await deps.compatService.check({ flag });
    if (!compat.ok)
      return err({
        kind: "transport" as const,
        reason:
          compat.error.kind === "probe-error"
            ? compat.error.message
            : compat.error.kind,
      });
    if (compat.value.kind === "below-floor") {
      return err({
        kind: "below-floor" as const,
        localCli: compat.value.localCli,
        serverMinClient: compat.value.serverMinClient,
      });
    }

    const resolved = await createAgentResolver({
      agentService: deps.createAgentService(host),
    }).resolve(agentRef);
    if (!resolved.ok) return resolved;

    const tok = await deps.tokenProvider.getValidAccessToken(host);
    if (!tok.ok)
      return err({ kind: "auth-required" as const, reason: tok.error.kind });

    return ok({
      host,
      token: tok.value,
      agentId: resolved.value.id,
      sessions: deps.createSessionsPort(host),
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
