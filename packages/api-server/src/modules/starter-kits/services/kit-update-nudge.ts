import type { Session } from "agent-runtime-api";
import type { SessionMessageEventPayload } from "agent-runtime-api";
import { isKitUpdateSession } from "api-server-api";
import type { KitUpdatePending } from "api-server-api";

import type { KitUpdateMarks } from "./kit-updates.js";

const SESSION_READ_TIMEOUT_MS = 10_000;

export interface KitUpdateNudge {
  turnEnded(agentId: string, sessionId: string): Promise<void>;
}

function nudgeText(targetCommit: string): string {
  return [
    `The Kit Update to ${targetCommit} is still pending.`,
    `If the checkout contains ${targetCommit} (git merge-base --is-ancestor ${targetCommit} HEAD), call report_kit_updated with commit ${targetCommit} now.`,
    "If you are waiting on the user for something, say what for and stop.",
  ].join(" ");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Kit Update is the agent's word, and an agent
 * that ends a turn without reporting one leaves the update pending with a user
 * who does not know it needs their word. This reminds the agent once per
 * update: when the turn that carries the update ends, the update is still
 * pending and it has not been reminded yet, it sends one notice into that same
 * Session. The mark goes down before the notice, so a crash between the two
 * costs the reminder rather than repeating it, and a second turn end never
 * reminds again. A Session the update did not open, an update already reported
 * or cancelled, and a Session the agent no longer lists are all left alone.
 */
export function createKitUpdateNudge(deps: {
  pending: (agentId: string) => Promise<KitUpdatePending | null>;
  marks: Pick<KitUpdateMarks, "nudge">;
  listSessions: (
    agentId: string,
    signal: AbortSignal,
  ) => Promise<{ sessions: Session[] }>;
  send: (
    agentId: string,
    payload: SessionMessageEventPayload,
  ) => Promise<unknown>;
  now?: () => Date;
}): KitUpdateNudge {
  const now = deps.now ?? (() => new Date());

  return {
    async turnEnded(agentId, sessionId) {
      const pending = await deps.pending(agentId);
      if (!pending || pending.nudgedAt !== undefined) return;
      const { sessions } = await deps.listSessions(
        agentId,
        AbortSignal.timeout(SESSION_READ_TIMEOUT_MS),
      );
      const session = sessions.find((s) => s.sessionId === sessionId);
      if (!session || !isKitUpdateSession(session, pending)) return;

      const marked = await deps.marks.nudge(
        agentId,
        pending,
        now().toISOString(),
      );
      if (!marked) return;
      await deps.send(agentId, {
        sessionId,
        text: nudgeText(pending.targetCommit),
        from: {},
        notice: true,
      });
    },
  };
}
