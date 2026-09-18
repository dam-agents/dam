import { randomUUID } from "node:crypto";
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
  wakeAgent: (agentId: string) => Promise<unknown>;
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
    `${ref} (${job.cmd.join(" ")}) — ${job.status}${
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

    const parts = await Promise.all(
      claimed.map((job) => describe(deps, agentId, job)),
    );
    const task = [
      claimed.length === 1
        ? "A satellite job you started has finished."
        : `${claimed.length} satellite jobs you started have finished.`,
      "",
      ...parts,
      "",
      "Carry on with whatever you were asked to do with this result. If nothing was asked, summarize it briefly.",
    ].join("\n");
    const payloadTask =
      task.length <= MAX_TURN_CHARS
        ? task
        : `${task.slice(0, MAX_TURN_CHARS)}\n(this turn was trimmed; read the rest with the satellite job tools)`;

    try {
      await deps.bump(agentId, [
        {
          id: randomUUID(),
          kind: "satellite-outcome",
          payload: {
            task: payloadTask,
            refs: claimed.map((job) =>
              formatJobRef(job.satellite, job.sequence),
            ),
          },
          expiresAt: new Date(Date.now() + EVENT_TTL_MS),
        },
      ]);
    } catch (err) {
      deps.log(
        `[satellites] could not write the outcome turn for ${agentId}: ${String(err)}`,
      );
      await releaseClaim(deps, claimed);
      return false;
    }

    try {
      await deps.enqueue(agentId);
    } catch (err) {
      deps.log(
        `[satellites] ${agentId} not enqueued; the outbox sweep will carry it: ${String(err)}`,
      );
    }

    try {
      await deps.wakeAgent(agentId);
      await deps.repo.markWoken(
        agentId,
        claimed.map((job) => ({
          satellite: job.satellite,
          sequence: job.sequence,
        })),
      );
    } catch (err) {
      deps.log(`[satellites] ${agentId} did not wake: ${String(err)}`);
    }
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
      if (await deliver(agentId)) continue;
      const claimed = await deps.repo.undeliveredFor(agentId);
      if (claimed.length === 0) continue;
      try {
        await deps.wakeAgent(agentId);
      } catch {
        continue;
      }
      await deps.repo.markWoken(agentId, claimed);
    }
    return agents.length;
  };
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
