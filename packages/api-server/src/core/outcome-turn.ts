import type { EventKind } from "agent-runtime-api";

const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TURN_CHARS = 64 * 1024;

export interface OutcomeTurnDeps {
  bump: (
    agentId: string,
    events: {
      id: string;
      kind: EventKind;
      payload: unknown;
      expiresAt: Date;
    }[],
  ) => Promise<number>;
  enqueue: (agentId: string) => Promise<void>;
  wakeUnlessStopped: (agentId: string) => Promise<boolean>;
  pairFields: (agentId: string) => Promise<Record<string, unknown>>;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one turn of finished outcomes, composed from their
 * descriptions under a character budget. A turn over the budget is trimmed, and
 * the note says where the rest can be read; a turn over the per-turn count stops
 * there, and the caller releases the rest for the next turn. `told` is how many
 * of the descriptions the turn carries.
 */
export function composeOutcomeTurn(opts: {
  descriptions: readonly string[];
  subject: (count: number) => string;
  trimHint: string;
  maxPerTurn: number;
}): { told: number; task: string } {
  const parts: string[] = [];
  let budget = MAX_TURN_CHARS;
  for (const part of opts.descriptions.slice(0, opts.maxPerTurn)) {
    if (parts.length > 0 && part.length + 1 > budget) break;
    const trimmed =
      part.length + 1 > budget
        ? `${part.slice(0, Math.max(budget - 1, 0))}\n(trimmed to fit this turn; ${opts.trimHint})`
        : part;
    parts.push(trimmed);
    budget -= trimmed.length + 1;
  }
  const task = [
    opts.subject(parts.length),
    "",
    ...parts,
    "",
    "Carry on with whatever you were asked to do with this result. If nothing was asked, summarize it briefly.",
  ].join("\n");
  return { told: parts.length, task };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Wakes an Agent for a turn already in its outbox,
 * unless the user stopped it: a stop wins, so the turn waits there for the
 * Agent's next deliberate wake, and the rows are marked woken either way so the
 * hourly retry does not wake it behind the user's back. The stop check and the
 * wake are one conditional write on the Agent, so a stop landing in between is
 * never erased.
 */
export async function wakeOutcomeTurn(
  deps: Pick<OutcomeTurnDeps, "wakeUnlessStopped" | "log">,
  opts: { tag: string; agentId: string; markWoken: () => Promise<void> },
): Promise<void> {
  try {
    if (!(await deps.wakeUnlessStopped(opts.agentId)))
      deps.log(
        `[${opts.tag}] ${opts.agentId} is stopped; its outcome turn waits for the next wake`,
      );
    await opts.markWoken();
  } catch (err) {
    deps.log(`[${opts.tag}] ${opts.agentId} did not wake: ${String(err)}`);
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: writes the turn as one outbox event with the pair
 * fields and a seven-day TTL, then marks it written, enqueues the Agent and
 * wakes it. A failed write releases the claim so the next tick owes the turn
 * again; a failed enqueue is only logged, because the outbox sweep carries it.
 */
export async function deliverOutcomeTurn(
  deps: OutcomeTurnDeps,
  turn: {
    tag: string;
    agentId: string;
    task: string;
    firedAt: number;
    event: {
      id: string;
      kind: EventKind;
      payloadKey: "ids" | "refs";
      payloadValues: string[];
    };
    release: () => Promise<void>;
    markWritten?: () => Promise<void>;
    wake: () => Promise<void>;
  },
): Promise<boolean> {
  try {
    await deps.bump(turn.agentId, [
      {
        id: turn.event.id,
        kind: turn.event.kind,
        payload: {
          task: turn.task,
          [turn.event.payloadKey]: turn.event.payloadValues,
          ...(await deps.pairFields(turn.agentId)),
        },
        expiresAt: new Date(turn.firedAt + EVENT_TTL_MS),
      },
    ]);
  } catch (err) {
    deps.log(
      `[${turn.tag}] could not write the outcome turn for ${turn.agentId}: ${String(err)}`,
    );
    await turn.release();
    return false;
  }
  if (turn.markWritten) await turn.markWritten();
  try {
    await deps.enqueue(turn.agentId);
  } catch (err) {
    deps.log(
      `[${turn.tag}] ${turn.agentId} not enqueued; the outbox sweep will carry it: ${String(err)}`,
    );
  }
  await turn.wake();
  return true;
}
