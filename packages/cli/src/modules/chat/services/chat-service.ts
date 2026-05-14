import { randomUUID } from "node:crypto";
import type { SessionView } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TokenProvider } from "../../auth/index.js";
import { createInstanceResolver, type InstanceService, type ResolveError } from "../../instance/index.js";
import { createSessionsClient } from "../infrastructure/sessions-client.js";
import { connectTerminalBridge, type BridgeResult } from "../infrastructure/terminal-bridge.js";

export type ChatError =
  | ResolveError
  | { kind: "no-server" }
  | { kind: "malformed-config"; reason: string }
  | { kind: "below-floor"; localCli: string; serverMinClient: string }
  | { kind: "not-a-tty" }
  | { kind: "session-failed"; reason: string }
  | { kind: "no-terminal-session" }
  | { kind: "multiple-terminal-sessions"; sessionIds: string[] }
  | { kind: "session-not-found"; sessionId: string }
  | { kind: "mode-switch-declined" };

export type SessionStrategy =
  | { kind: "new" }
  | { kind: "continue" }
  | { kind: "resume"; sessionId: string };

export interface ChatService {
  run(input: { instanceRef: string; serverFlag?: string; strategy: SessionStrategy; reset?: boolean }):
    Promise<Result<{ bridge: BridgeResult; sessionId: string }, ChatError>>;
  listSessions(input: { instanceRef: string; serverFlag?: string }):
    Promise<Result<readonly SessionView[], ChatError>>;
}

export function createChatService(deps: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createInstanceService: (host: string) => InstanceService;
  confirmModeSwitch: () => Promise<boolean>;
  isTty: boolean;
}): ChatService {
  async function bootstrap(instanceRef: string, serverFlag?: string) {
    const flag = serverFlag ? { server: serverFlag } : undefined;
    const config = await deps.configService.getResolved({ flag });
    if (!config.ok) {
      return config.error.kind === "malformed-config"
        ? err({ kind: "malformed-config" as const, reason: config.error.reason })
        : err({ kind: "no-server" as const });
    }
    const host = config.value.server;

    const compat = await deps.compatService.check({ flag });
    if (compat.ok && compat.value.kind === "below-floor") {
      return err({ kind: "below-floor" as const, localCli: compat.value.localCli, serverMinClient: compat.value.serverMinClient });
    }

    const resolved = await createInstanceResolver({ instanceService: deps.createInstanceService(host) }).resolve(instanceRef);
    if (!resolved.ok) return resolved;

    const tok = await deps.tokenProvider.getValidAccessToken(host);
    if (!tok.ok) return err({ kind: "auth-required" as const, reason: tok.error.kind });

    return ok({
      host, token: tok.value, instanceId: resolved.value.id,
      sessions: createSessionsClient({ host, token: tok.value }),
    });
  }

  function wsUrl(host: string, instanceId: string, token: string, sessionId: string, reset?: boolean) {
    const proto = host.startsWith("https://") ? "wss:" : "ws:";
    const base = host.replace(/^https?:\/\//, "");
    return `${proto}//${base}/api/instances/${encodeURIComponent(instanceId)}/terminal?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}${reset ? "&reset=1" : ""}`;
  }

  return {
    async listSessions(input) {
      const ctx = await bootstrap(input.instanceRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      return ctx.value.sessions.list(ctx.value.instanceId);
    },

    async run(input) {
      if (!deps.isTty) return err({ kind: "not-a-tty" });

      const ctx = await bootstrap(input.instanceRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const { host, token, instanceId, sessions } = ctx.value;

      let sessionId: string;
      const { strategy } = input;

      if (strategy.kind === "new") {
        sessionId = randomUUID();
        const created = await sessions.create(sessionId, instanceId);
        if (!created.ok) return created;
      } else if (strategy.kind === "continue") {
        const listed = await sessions.list(instanceId);
        if (!listed.ok) return listed;
        const terminals = listed.value.filter((s) => s.mode === "terminal" && s.type === "regular");
        if (terminals.length === 0) return err({ kind: "no-terminal-session" });
        if (terminals.length > 1) return err({ kind: "multiple-terminal-sessions", sessionIds: terminals.map((s) => s.sessionId) });
        sessionId = terminals[0]!.sessionId;
      } else {
        const listed = await sessions.list(instanceId);
        if (!listed.ok) return listed;
        const target = listed.value.find((s) => s.sessionId === strategy.sessionId);
        if (!target) return err({ kind: "session-not-found", sessionId: strategy.sessionId });
        if (target.mode === "chat") {
          if (!await deps.confirmModeSwitch()) return err({ kind: "mode-switch-declined" });
          const switched = await sessions.setMode(target.sessionId, instanceId, "terminal");
          if (!switched.ok) return switched;
        }
        sessionId = target.sessionId;
      }

      const bridge = await connectTerminalBridge({
        wsUrl: wsUrl(host, instanceId, token, sessionId, input.reset),
        stdin: process.stdin as NodeJS.ReadStream & { setRawMode(mode: boolean): void },
        stdout: process.stdout,
      });

      return ok({ bridge, sessionId });
    },
  };
}
