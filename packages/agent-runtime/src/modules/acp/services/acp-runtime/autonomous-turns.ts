import { randomUUID } from "node:crypto";

const DEFAULT_QUIET_MS = 60 * 1000;

const OPENING_UPDATES = new Set([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
]);

export interface AutonomousTurns {
  turnFor(sessionId: string, sessionUpdate: string | null): string | null;
  afterFrame(sessionId: string, sessionUpdate: string | null): void;
  end(sessionId: string): void;
  clear(): void;
}

export interface AutonomousTurnsDeps {
  onEnded: (sessionId: string, turnId: string) => void;
  quietMs?: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Gives a turn to work the harness does on its own,
 * outside any prompt the runtime sent — a model that resumes when its
 * background task finishes. Agent output with no prompt turn running opens
 * one; the harness's usage report, which ends every model result, closes it,
 * and so does a quiet period for a harness that reports none. A prompt
 * starting meanwhile ends it first, so a frame always belongs to one turn.
 */
export function createAutonomousTurns(
  deps: AutonomousTurnsDeps,
): AutonomousTurns {
  const open = new Map<
    string,
    { turnId: string; timer: ReturnType<typeof setTimeout> }
  >();
  const quietMs = deps.quietMs ?? DEFAULT_QUIET_MS;

  function end(sessionId: string): void {
    const turn = open.get(sessionId);
    if (turn === undefined) return;
    clearTimeout(turn.timer);
    open.delete(sessionId);
    deps.onEnded(sessionId, turn.turnId);
  }

  function armQuiet(sessionId: string, turnId: string) {
    return setTimeout(() => {
      if (open.get(sessionId)?.turnId === turnId) end(sessionId);
    }, quietMs);
  }

  return {
    turnFor(sessionId, sessionUpdate) {
      const turn = open.get(sessionId);
      if (turn !== undefined) {
        clearTimeout(turn.timer);
        turn.timer = armQuiet(sessionId, turn.turnId);
        return turn.turnId;
      }
      if (sessionUpdate === null || !OPENING_UPDATES.has(sessionUpdate))
        return null;
      const turnId = randomUUID();
      open.set(sessionId, { turnId, timer: armQuiet(sessionId, turnId) });
      return turnId;
    },

    afterFrame(sessionId, sessionUpdate) {
      if (sessionUpdate === "usage_update") end(sessionId);
    },

    end,

    clear() {
      for (const turn of open.values()) clearTimeout(turn.timer);
      open.clear();
    },
  };
}
