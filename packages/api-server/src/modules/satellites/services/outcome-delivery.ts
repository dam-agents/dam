import { randomUUID } from "node:crypto";
import type { EventKind } from "agent-runtime-api";
import { INLINE_OUTPUT_LIMIT, formatJobRef } from "api-server-api";
import type { JobRow } from "../domain/types.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  const head = `${ref} (${job.cmd.join(" ")}) — ${job.status}${
    job.exitCode === null ? "" : `, exit ${job.exitCode}`
  }`;
  if (job.reason !== null) return `${head}\n${job.reason}`;
  const output = job.output ?? "";
  if (output === "") return head;
  if (output.length <= INLINE_OUTPUT_LIMIT) return `${head}\n${output}`;
  const path = await deps.spillLog(agentId, ref, output);
  return path === null
    ? `${head}\n(output too large to include and could not be written to your workspace)`
    : `${head}\nOutput was too large to include; it is at ${path}`;
}

export function createOutcomeDelivery(deps: OutcomeDeliveryDeps) {
  return async (agentId: string): Promise<boolean> => {
    const claimed = await deps.repo.claimUndeliveredOutcomes(agentId);
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

    try {
      await deps.bump(agentId, [
        {
          id: randomUUID(),
          kind: "satellite-outcome",
          payload: {
            task,
            refs: claimed.map((job) =>
              formatJobRef(job.satellite, job.sequence),
            ),
          },
          expiresAt: new Date(Date.now() + EVENT_TTL_MS),
        },
      ]);
      await deps.enqueue(agentId);
    } catch (err) {
      deps.log(
        `[satellites] could not enqueue the outcome wake for ${agentId}: ${String(err)}`,
      );
      return false;
    }
    await deps.wakeAgent(agentId).catch((err: unknown) => {
      deps.log(`[satellites] ${agentId} did not wake: ${String(err)}`);
    });
    return true;
  };
}

export function createOutcomeWakeRetry(deps: OutcomeDeliveryDeps) {
  return async (): Promise<number> => {
    const agents = await deps.repo.agentsWithPendingOutcomes();
    for (const agentId of agents) await deps.wakeAgent(agentId).catch(() => {});
    return agents.length;
  };
}
