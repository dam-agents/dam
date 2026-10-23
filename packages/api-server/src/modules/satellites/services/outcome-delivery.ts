import { INLINE_OUTPUT_LIMIT, formatJobRef } from "api-server-api";
import {
  composeOutcomeTurn,
  deliverOutcomeTurn,
  wakeOutcomeTurn,
  type OutcomeTurnDeps,
} from "../../../core/outcome-turn.js";
import type { JobRow } from "../domain/types.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

const MAX_OUTCOMES_PER_TURN = 20;

export interface OutcomeDeliveryDeps extends OutcomeTurnDeps {
  repo: SatellitesRepository;
  spillLog: (
    agentId: string,
    ref: string,
    output: string,
  ) => Promise<string | null>;
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

    const { told, task } = composeOutcomeTurn({
      descriptions: await Promise.all(
        claimed.map((job) => describe(deps, agentId, job)),
      ),
      subject: (count) =>
        count === 1
          ? "A satellite job you started has finished."
          : `${count} satellite jobs you started have finished.`,
      trimHint: "read the rest with the satellite job tools",
      maxPerTurn: MAX_OUTCOMES_PER_TURN,
    });
    const toldJobs = claimed.slice(0, told);
    const overflow = claimed.slice(told);
    if (overflow.length > 0) await releaseClaim(deps, overflow);

    const refs = toldJobs.map((job) =>
      formatJobRef(job.satellite, job.sequence),
    );
    const firedAt = Date.now();
    return deliverOutcomeTurn(deps, {
      tag: "satellites",
      agentId,
      task,
      firedAt,
      event: {
        id: `satellite-outcome:${agentId}:${refs[0]!}:${firedAt}`,
        kind: "satellite-outcome",
        payloadKey: "refs",
        payloadValues: refs,
      },
      release: () => releaseClaim(deps, toldJobs),
      wake: () =>
        wakeOutcomeTurn(deps, {
          tag: "satellites",
          agentId,
          markWoken: () => deps.repo.markWoken(agentId, jobRefs(toldJobs)),
        }),
    });
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
        await wakeOutcomeTurn(deps, {
          tag: "satellites",
          agentId,
          markWoken: () => deps.repo.markWoken(agentId, claimed),
        });
      } catch (err) {
        deps.log(
          `[satellites] the outcome sweep skipped ${agentId}: ${String(err)}`,
        );
      }
    }
    return agents.length;
  };
}

function jobRefs(jobs: JobRow[]): { satellite: string; sequence: number }[] {
  return jobs.map((job) => ({
    satellite: job.satellite,
    sequence: job.sequence,
  }));
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
