import type { SessionView } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

export type SessionStrategy =
  | { kind: "new" }
  | { kind: "continue" }
  | { kind: "resume"; sessionId: string };

export type SessionDecision =
  | { action: "create"; sessionId: string }
  | { action: "attach"; sessionId: string }
  | { action: "switch-and-attach"; sessionId: string };

export type SessionDecisionError =
  | { kind: "no-terminal-session" }
  | { kind: "multiple-terminal-sessions"; sessionIds: string[] }
  | { kind: "session-not-found"; sessionId: string };

export function resolveSession(
  strategy: SessionStrategy,
  sessions: readonly SessionView[],
  newSessionId: string,
): Result<SessionDecision, SessionDecisionError> {
  if (strategy.kind === "new") {
    return ok({ action: "create", sessionId: newSessionId });
  }

  if (strategy.kind === "continue") {
    const terminals = sessions.filter((s) => s.mode === "terminal" && s.type === "regular");
    if (terminals.length === 0) return err({ kind: "no-terminal-session" });
    if (terminals.length > 1) return err({ kind: "multiple-terminal-sessions", sessionIds: terminals.map((s) => s.sessionId) });
    return ok({ action: "attach", sessionId: terminals[0]!.sessionId });
  }

  const target = sessions.find((s) => s.sessionId === strategy.sessionId);
  if (!target) return err({ kind: "session-not-found", sessionId: strategy.sessionId });
  if (target.mode === "chat") return ok({ action: "switch-and-attach", sessionId: target.sessionId });
  return ok({ action: "attach", sessionId: target.sessionId });
}
