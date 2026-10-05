import type { EventKind } from "agent-runtime-api";
import type { InvocationRow } from "../infrastructure/invocations-repository.js";
import type { SubAgentOutcomesRepository } from "../infrastructure/sub-agent-outcomes-repository.js";

const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_BATCH = 100;
export const CLAIM_LEASE_MS = 60_000;
const MAX_OUTCOMES_PER_TURN = 20;
const MAX_TURN_CHARS = 64 * 1024;
const RETRY_BATCH = 200;

export interface SubAgentOutcomeDeliveryDeps {
  repo: SubAgentOutcomesRepository;
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
  agentStopped: (agentId: string) => Promise<boolean>;
  wakeAgent: (agentId: string) => Promise<unknown>;
  log: (msg: string) => void;
  now?: () => Date;
}

function describe(row: InvocationRow): string {
  const name = row.label ? `${row.label} (${row.id})` : row.id;
  return row.status === "done"
    ? `${name} — done. Result:\n${JSON.stringify(row.result, null, 2)}`
    : `${name} — failed: ${row.errorReason ?? "no reason recorded"}`;
}

function composeTurn(rows: InvocationRow[]): {
  told: InvocationRow[];
  task: string;
} {
  const told: InvocationRow[] = [];
  const parts: string[] = [];
  let budget = MAX_TURN_CHARS;
  for (const row of rows.slice(0, MAX_OUTCOMES_PER_TURN)) {
    const part = describe(row);
    if (told.length > 0 && part.length + 1 > budget) break;
    const trimmed =
      part.length + 1 > budget
        ? `${part.slice(0, Math.max(budget - 1, 0))}\n(trimmed to fit this turn; call await_subagents with this id for the full result)`
        : part;
    told.push(row);
    parts.push(trimmed);
    budget -= trimmed.length + 1;
  }
  const task = [
    told.length === 1
      ? "A sub-agent you spawned has finished."
      : `${told.length} sub-agents you spawned have finished.`,
    "",
    ...parts,
    "",
    "Carry on with whatever you were asked to do with this result. If nothing was asked, summarize it briefly.",
  ].join("\n");
  return { told, task };
}

function byDriver(rows: InvocationRow[]): Map<string, InvocationRow[]> {
  const grouped = new Map<string, InvocationRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.driverAgentId) ?? [];
    list.push(row);
    grouped.set(row.driverAgentId, list);
  }
  return grouped;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Wakes a Driver for turns already in its outbox,
 * unless the user stopped it: a stop wins, so the turn waits there for the
 * Driver's next deliberate wake, and the rows are marked woken either way so
 * the hourly retry does not wake it behind the user's back.
 */
async function wake(
  deps: SubAgentOutcomeDeliveryDeps,
  driverAgentId: string,
  rows: InvocationRow[],
): Promise<void> {
  try {
    if (await deps.agentStopped(driverAgentId)) {
      deps.log(
        `[sub-agents] ${driverAgentId} is stopped; its outcome turn waits for the next wake`,
      );
    } else {
      await deps.wakeAgent(driverAgentId);
    }
    await deps.repo.markWoken(rows.map((r) => r.id));
  } catch (err) {
    deps.log(`[sub-agents] ${driverAgentId} did not wake: ${String(err)}`);
  }
}

async function deliverTo(
  deps: SubAgentOutcomeDeliveryDeps,
  driverAgentId: string,
  rows: InvocationRow[],
): Promise<boolean> {
  const { told, task } = composeTurn(rows);
  const toldIds = new Set(told.map((r) => r.id));
  await deps.repo.release(
    rows.filter((r) => !toldIds.has(r.id)).map((r) => r.id),
  );

  const ids = told.map((r) => r.id);
  const firedAt = (deps.now ?? (() => new Date()))().getTime();
  try {
    await deps.bump(driverAgentId, [
      {
        id: `sub-agent-outcome:${driverAgentId}:${ids[0]!}:${firedAt}`,
        kind: "sub-agent-outcome",
        payload: { task, ids },
        expiresAt: new Date(firedAt + EVENT_TTL_MS),
      },
    ]);
  } catch (err) {
    deps.log(
      `[sub-agents] could not write the outcome turn for ${driverAgentId}: ${String(err)}`,
    );
    await deps.repo.release(ids);
    return false;
  }
  await deps.repo.markDelivered(ids);

  try {
    await deps.enqueue(driverAgentId);
  } catch (err) {
    deps.log(
      `[sub-agents] ${driverAgentId} not enqueued; the outbox sweep will carry it: ${String(err)}`,
    );
  }
  await wake(deps, driverAgentId, told);
  return true;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Tells a Driver about sub-agents it spawned through
 * the spawn_subagent tool that finished while no await_subagents call covered
 * them. Each tick leases such outcomes cluster-wide for one lease, writes one
 * sub-agent-outcome turn per Driver, marks them delivered only once the turn is
 * written, and wakes the Driver; outcomes past one turn's budget are released
 * for the next tick. A lease the server dies holding expires, so one outcome
 * owes at least one turn and loses none. Script spawns are never claimed:
 * their driver polls.
 */
export function createSubAgentOutcomeDelivery(
  deps: SubAgentOutcomeDeliveryDeps,
) {
  const now = deps.now ?? (() => new Date());
  return async (): Promise<number> => {
    const claimed = await deps.repo.claimUndelivered(
      CLAIM_BATCH,
      new Date(now().getTime() + CLAIM_LEASE_MS),
    );
    let turns = 0;
    for (const [driverAgentId, rows] of byDriver(claimed)) {
      try {
        if (await deliverTo(deps, driverAgentId, rows)) turns++;
      } catch (err) {
        deps.log(
          `[sub-agents] the outcome sweep skipped ${driverAgentId}: ${String(err)}`,
        );
      }
    }
    return turns;
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Hourly recovery for outcome turns already written
 * whose Driver did not wake, typically one parked over budget. It only wakes;
 * the turn is in the outbox, and announcing again would owe two turns.
 */
export function createSubAgentOutcomeWakeRetry(
  deps: SubAgentOutcomeDeliveryDeps,
) {
  return async (): Promise<number> => {
    const rows = await deps.repo.listDeliveredUnwoken(RETRY_BATCH);
    const grouped = byDriver(rows);
    for (const [driverAgentId, driverRows] of grouped)
      await wake(deps, driverAgentId, driverRows);
    return grouped.size;
  };
}
