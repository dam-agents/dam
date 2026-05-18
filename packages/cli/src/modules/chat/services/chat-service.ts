import type { SessionView, TerminalStrategy } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TokenProvider } from "../../auth/index.js";
import {
  createInstanceResolver,
  type InstanceService,
  type ResolveError,
} from "../../instance/index.js";
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
    instanceRef: string;
    serverFlag?: string;
    strategy: TerminalStrategy;
    reset?: boolean;
  }): Promise<Result<{ bridge: BridgeResult; sessionId: string }, ChatError>>;
  listSessions(input: {
    instanceRef: string;
    serverFlag?: string;
  }): Promise<Result<readonly SessionView[], ChatError>>;
}

export function createChatService(deps: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createInstanceService: (host: string) => InstanceService;
  createSessionsPort: (host: string) => SessionsPort;
  confirmModeSwitch: () => Promise<boolean>;
  isTty: boolean;
}): ChatService {
  async function bootstrap(instanceRef: string, serverFlag?: string) {
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

    const resolved = await createInstanceResolver({
      instanceService: deps.createInstanceService(host),
    }).resolve(instanceRef);
    if (!resolved.ok) return resolved;

    const tok = await deps.tokenProvider.getValidAccessToken(host);
    if (!tok.ok)
      return err({ kind: "auth-required" as const, reason: tok.error.kind });

    return ok({
      host,
      token: tok.value,
      instanceId: resolved.value.id,
      sessions: deps.createSessionsPort(host),
    });
  }

  return {
    async listSessions(input) {
      const ctx = await bootstrap(input.instanceRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const result = await ctx.value.sessions.list(ctx.value.instanceId);
      if (!result.ok)
        return err({
          kind: "session-failed" as const,
          reason: result.error.reason,
        });
      return result;
    },

    async run(input) {
      if (!deps.isTty) return err({ kind: "not-a-tty" });

      const ctx = await bootstrap(input.instanceRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const { host, token, instanceId, sessions } = ctx.value;

      let resolution = await sessions.resolveTerminal(
        instanceId,
        input.strategy,
        { reset: input.reset },
      );
      if (!resolution.ok)
        return err({
          kind: "session-failed" as const,
          reason: resolution.error.reason,
        });

      if (resolution.value.kind === "confirm-mode-switch") {
        if (!(await deps.confirmModeSwitch()))
          return err({ kind: "mode-switch-declined" });
        resolution = await sessions.resolveTerminal(
          instanceId,
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
