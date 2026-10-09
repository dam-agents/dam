import type { EventKind } from "agent-runtime-api";
import { INLINE_OUTPUT_LIMIT, formatJobRef } from "api-server-api";
import type { JobRow } from "../domain/types.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OUTCOMES_PER_TURN = 20;
const MAX_TURN_CHARS = 64 * 1024;

export interface OutcomeDeliveryDeps {
  repo: SatellitesRepository;
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
  spillLog: (
    agentId: string,
    ref: string,
    output: string,
  ) => Promise<string | null>;
  log: (msg: string) => void;
}

async function describe(
  deps: OutcomeDeliveryDeps,
  agentId: string,
  job: JobRow,
): Promise<string> {
  const ref = formatJobRef(job.satellite, job.sequence);
  const lines = [
    `${ref} (${job.tool} ${JSON.stringify(job.args)}) — ${job.status}${
      job.exitCode === null ? "" : `, exit ${job.exitCode}`
    }`,
  ];
  if (job.reason !== null) lines.push(job.reason);
  const output = job.output ?? "";
  if (output !== "") {
    if (output.length <= INLINE_OUTPUT_LIMIT) lines.push(output);
    else {
      const path = await deps.spillLog(agentId, ref, output);
      lines.push(
        path === null
          ? "(output too large to include and could not be written to your workspace)"
          : `Output was too large to include; it is at ${path}`,
      );
    }
  }
  return lines.join("\n");
}

export function createOutcomeDelivery(deps: OutcomeDeliveryDeps) {
  return async (agentId: string): Promise<boolean> => {
    const claimed = await deps.repo.claimUndeliveredOutcomes(
      agentId,
      MAX_OUTCOMES_PER_TURN,
    );
    if (claimed.length === 0) return false;

    const described = await Promise.all(
      claimed.map((job) => describe(deps, agentId, job)),
    );
    const told: JobRow[] = [];
    const parts: string[] = [];
    let budget = MAX_TURN_CHARS;
    for (const [index, part] of described.entries()) {
      if (told.length > 0 && part.length + 1 > budget) break;
      const trimmed =
        part.length + 1 > budget
          ? `${part.slice(0, Math.max(budget - 1, 0))}\n(trimmed to fit this turn; read the rest with the satellite job tools)`
          : part;
      told.push(claimed[index]!);
      parts.push(trimmed);
      budget -= trimmed.length + 1;
    }
    const overflow = claimed.slice(told.length);
    if (overflow.length > 0) await releaseClaim(deps, overflow);

    const task = [
      told.length === 1
        ? "A satellite job you started has finished."
        : `${told.length} satellite jobs you started have finished.`,
      "",
      ...parts,
      "",
      "Carry on with whatever you were asked to do with this result. If nothing was asked, summarize it briefly.",
    ].join("\n");

    const refs = told.map((job) => formatJobRef(job.satellite, job.sequence));
    const firedAt = Date.now();
    try {
      await deps.bump(agentId, [
        {
          id: `satellite-outcome:${agentId}:${refs[0]!}:${firedAt}`,
          kind: "satellite-outcome",
          payload: { task, refs },
          expiresAt: new Date(firedAt + EVENT_TTL_MS),
        },
      ]);
    } catch (err) {
      deps.log(
        `[satellites] could not write the outcome turn for ${agentId}: ${String(err)}`,
      );
      await releaseClaim(deps, told);
      return false;
    }

    try {
      await deps.enqueue(agentId);
    } catch (err) {
      deps.log(
        `[satellites] ${agentId} not enqueued; the outbox sweep will carry it: ${String(err)}`,
      );
    }

    await wake(
      deps,
      agentId,
      told.map((job) => ({ satellite: job.satellite, sequence: job.sequence })),
    );
    return true;
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Hourly recovery for outcomes that have not reached
 * their Agent, and the two states need opposite treatment. An outcome nobody has
 * claimed has no turn written for it, so waking would bring the Agent up with
 * nothing to read: it is announced. An outcome already claimed has its turn in
 * the outbox and only lacks a running Agent — typically one parked over budget —
 * so it is re-woken, never announced again, because one job owes one turn.
 */
export function createOutcomeWakeRetry(
  deps: OutcomeDeliveryDeps,
  deliver: (agentId: string) => Promise<boolean>,
) {
  return async (): Promise<number> => {
    const agents = await deps.repo.agentsWithPendingOutcomes();
    for (const agentId of agents) {
      try {
        if (await deliver(agentId)) continue;
        const claimed = await deps.repo.undeliveredFor(agentId);
        if (claimed.length === 0) continue;
        await wake(deps, agentId, claimed);
      } catch (err) {
        deps.log(
          `[satellites] the outcome sweep skipped ${agentId}: ${String(err)}`,
        );
      }
    }
    return agents.length;
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Wakes an Agent for a turn already in its outbox,
 * unless the user stopped it: a stop wins, so the turn waits there for the
 * Agent's next deliberate wake, and the Jobs are marked woken either way so
 * the hourly retry does not wake it behind the user's back. The stop check
 * and the wake are one conditional write on the Agent, so a stop landing in
 * between is never erased.
 */
async function wake(
  deps: OutcomeDeliveryDeps,
  agentId: string,
  jobs: { satellite: string; sequence: number }[],
): Promise<void> {
  try {
    if (!(await deps.wakeUnlessStopped(agentId)))
      deps.log(
        `[satellites] ${agentId} is stopped; its outcome turn waits for the next wake`,
      );
    await deps.repo.markWoken(agentId, jobs);
  } catch (err) {
    deps.log(`[satellites] ${agentId} did not wake: ${String(err)}`);
  }
}

async function releaseClaim(
  deps: OutcomeDeliveryDeps,
  claimed: JobRow[],
): Promise<void> {
  for (const satellite of new Set(claimed.map((job) => job.satellite)))
    await deps.repo.releaseOutcomes(
      claimed[0]!.owner,
      satellite,
      claimed
        .filter((job) => job.satellite === satellite)
        .map((job) => job.sequence),
    );
}
