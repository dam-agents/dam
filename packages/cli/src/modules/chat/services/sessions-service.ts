import { randomUUID } from "node:crypto";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import type { AcpSessionClient } from "../infrastructure/acp-session-client.js";

/** How `dam chat` picks the terminal session to attach to. Owned by the CLI:
 *  ADR-055 removed the server-side session store, so strategy resolution is a
 *  client-side computation over the agent's live ACP session list. */
export type TerminalStrategy =
  | { kind: "new" }
  | { kind: "continue" }
  | { kind: "resume"; sessionId: string };

export type SessionResolution =
  | { kind: "ready"; sessionId: string; terminalPath: string }
  | { kind: "confirm-mode-switch"; sessionId: string; currentMode: SessionMode }
  | { kind: "no-terminal-session" }
  | { kind: "multiple-terminal-sessions"; sessionIds: string[] }
  | { kind: "session-not-found"; sessionId: string };

export interface SessionsPort {
  list(
    agentId: string,
  ): Promise<
    Result<readonly SessionView[], TransportError | AuthRequiredError>
  >;
  resolveTerminal(
    agentId: string,
    strategy: TerminalStrategy,
    opts?: { reset?: boolean; force?: boolean },
  ): Promise<Result<SessionResolution, TransportError | AuthRequiredError>>;
}

function transportError(e: unknown): TransportError {
  return {
    kind: "transport",
    reason: e instanceof Error ? e.message : String(e),
  };
}

export function createSessionsPort(deps: {
  acp: AcpSessionClient;
}): SessionsPort {
  return {
    async list(agentId) {
      try {
        return ok(await deps.acp.list(agentId));
      } catch (e) {
        return err(transportError(e));
      }
    },

    async resolveTerminal(agentId, strategy, opts) {
      const terminalPath = (sid: string) =>
        `/api/agents/${encodeURIComponent(agentId)}/terminal?sessionId=${encodeURIComponent(sid)}${opts?.reset ? "&reset=1" : ""}`;
      const ready = (sid: string): SessionResolution => ({
        kind: "ready",
        sessionId: sid,
        terminalPath: terminalPath(sid),
      });

      try {
        // `new` needs no agent round-trip: the PTY mints the session on attach
        // and it surfaces in session/list with no `_meta` (terminal default).
        if (strategy.kind === "new") return ok(ready(randomUUID()));

        // `continue` / `resume` resolve against the agent's live session list.
        const regular = (await deps.acp.list(agentId)).filter(
          (s) => s.type === SessionType.Regular,
        );

        if (strategy.kind === "continue") {
          const terminals = regular.filter(
            (s) => s.mode === SessionMode.Terminal,
          );
          if (terminals.length === 0)
            return ok<SessionResolution>({ kind: "no-terminal-session" });
          if (terminals.length > 1)
            return ok<SessionResolution>({
              kind: "multiple-terminal-sessions",
              sessionIds: terminals.map((s) => s.sessionId),
            });
          return ok(ready(terminals[0]!.sessionId));
        }

        const target = regular.find((s) => s.sessionId === strategy.sessionId);
        if (!target)
          return ok<SessionResolution>({
            kind: "session-not-found",
            sessionId: strategy.sessionId,
          });

        // Resuming a chat session in the terminal re-categorizes it; confirm
        // first unless forced, then persist the flip over ACP.
        if (target.mode === SessionMode.Chat) {
          if (!opts?.force)
            return ok<SessionResolution>({
              kind: "confirm-mode-switch",
              sessionId: target.sessionId,
              currentMode: SessionMode.Chat,
            });
          await deps.acp.setMode(
            agentId,
            target.sessionId,
            SessionMode.Terminal,
          );
        }

        return ok(ready(target.sessionId));
      } catch (e) {
        return err(transportError(e));
      }
    },
  };
}
