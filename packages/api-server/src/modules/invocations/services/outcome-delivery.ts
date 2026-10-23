import {
  composeOutcomeTurn,
  deliverOutcomeTurn,
  wakeOutcomeTurn,
  type OutcomeTurnDeps,
} from "../../../core/outcome-turn.js";
import { heldStreams } from "../domain/script-output.js";
import type { InvocationRow } from "../infrastructure/invocations-repository.js";
import type { SubAgentOutcomesRepository } from "../infrastructure/sub-agent-outcomes-repository.js";

const CLAIM_BATCH = 100;
export const CLAIM_LEASE_MS = 60_000;
const MAX_OUTCOMES_PER_TURN = 20;
const RETRY_BATCH = 200;

export interface SubAgentOutcomeDeliveryDeps extends OutcomeTurnDeps {
  repo: SubAgentOutcomesRepository;
  now?: () => Date;
}

function describe(row: InvocationRow): string {
  const name = row.label ? `${row.label} (${row.id})` : row.id;
  if (row.script !== null) return describeScript(name, row);
  return row.status === "done"
    ? `${name} — done. Result:\n${JSON.stringify(row.result, null, 2)}`
    : `${name} — failed: ${row.errorReason ?? "no reason recorded"}`;
}

function describeScript(name: string, row: InvocationRow): string {
  const ended =
    row.status === "done"
      ? `${name}: the script is done, exit code 0.`
      : `${name}: the script failed: ${row.errorReason ?? "no reason recorded"}.`;
  const held = heldStreams(row.output);
  const streams =
    held.length > 0
      ? `Its ${held
          .map((s) => `${s} is ${row.output![s]!.sizeBytes} bytes`)
          .join(
            ", ",
          )}; call await_subagents with this id to see their start and end, or fetch_subagent_output to save one in full to a file.`
      : "It left no output to read.";
  return `${ended} ${streams}`;
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

async function deliverTo(
  deps: SubAgentOutcomeDeliveryDeps,
  now: () => Date,
  lease: Date,
  driverAgentId: string,
  rows: InvocationRow[],
): Promise<boolean> {
  const { told, task } = composeOutcomeTurn({
    descriptions: rows.map(describe),
    subject: (count) =>
      count === 1
        ? "A sub-agent you spawned has finished."
        : `${count} sub-agents you spawned have finished.`,
    trimHint: "call await_subagents with this id for the full result",
    maxPerTurn: MAX_OUTCOMES_PER_TURN,
  });
  await deps.repo.release(
    rows.slice(told).map((r) => r.id),
    lease,
  );

  const ids = rows.slice(0, told).map((r) => r.id);
  const firedAt = now().getTime();
  return deliverOutcomeTurn(deps, {
    tag: "sub-agents",
    agentId: driverAgentId,
    task,
    firedAt,
    event: {
      id: `sub-agent-outcome:${driverAgentId}:${ids[0]!}:${firedAt}`,
      kind: "sub-agent-outcome",
      payloadKey: "ids",
      payloadValues: ids,
    },
    release: () => deps.repo.release(ids, lease),
    markWritten: () => deps.repo.markDelivered(ids, lease),
    wake: () =>
      wakeOutcomeTurn(deps, {
        tag: "sub-agents",
        agentId: driverAgentId,
        markWoken: () => deps.repo.markWoken(ids),
      }),
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Tells a Driver about sub-agents it spawned through
 * the spawn_subagent tool that finished while no await_subagents call covered
 * them. Each tick leases such outcomes cluster-wide for one lease, writes one
 * sub-agent-outcome turn per Driver, marks them delivered only once the turn is
 * written, and wakes the Driver; outcomes past one turn's budget are released
 * for the next tick. Every write after the claim names the lease, so a tick
 * that outlives its lease cannot touch a row another tick holds. A lease the
 * server dies holding expires, so one outcome owes at least one turn and
 * loses none. Script spawns are never claimed:
 * their driver polls.
 */
export function createSubAgentOutcomeDelivery(
  deps: SubAgentOutcomeDeliveryDeps,
) {
  const now = deps.now ?? (() => new Date());
  return async (): Promise<number> => {
    const lease = new Date(now().getTime() + CLAIM_LEASE_MS);
    const claimed = await deps.repo.claimUndelivered(CLAIM_BATCH, lease);
    let turns = 0;
    for (const [driverAgentId, rows] of byDriver(claimed)) {
      try {
        if (await deliverTo(deps, now, lease, driverAgentId, rows)) turns++;
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
      await wakeOutcomeTurn(deps, {
        tag: "sub-agents",
        agentId: driverAgentId,
        markWoken: () => deps.repo.markWoken(driverRows.map((r) => r.id)),
      });
    return grouped.size;
  };
}
