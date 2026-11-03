import { TRPCError } from "@trpc/server";
import {
  formatJobRef,
  type ClaimInput,
  type HeartbeatInput,
  type ReportInput,
  type SatelliteManifest,
  type WorkItem,
} from "api-server-api";
import type { JobRow } from "../domain/types.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

export const LEASE_MS = 60_000;
const STALE_JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_POLL_MS = 500;

export interface WorkerOpsDeps {
  repo: SatellitesRepository;
  maxConcurrentCeiling: number;
  deliverOutcome: (input: {
    owner: string;
    agentId: string;
    satellite: string;
    sequence: number;
  }) => Promise<void>;
  agentName?: (agentId: string) => Promise<string | null>;
  now?: () => Date;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Satellite side of the queue — connect, claim,
 * heartbeat, report, drain. It moves MCP tool calls out and outcomes back and
 * never reads either: only the machine knows what its arguments mean.
 *
 */
export function createSatelliteWorkerOps(deps: WorkerOpsDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    /**
     * UNIT_BOUNDARY_DESCRIPTION: Registers a Satellite, or replaces what an
     * existing one offers. A worker that has served this name before says which
     * registration it served, and only that one is written: a name that was
     * removed, or registered again since, has another incarnation, so the answer
     * is that there is no such Satellite. Registering anyway would undo a
     * removal, or take a name over from the machine that holds it, and both are
     * the owner's decisions. A worker registering for the first time says
     * nothing and takes the name.
     */
    async connect(
      owner: string,
      manifest: SatelliteManifest,
      host?: string,
      resume?: string,
    ): Promise<{ incarnation: string }> {
      if (resume === undefined)
        return deps.repo.upsertFromManifest(
          owner,
          manifest,
          host ?? null,
          deps.maxConcurrentCeiling,
        );
      const renewed = await deps.repo.renewFromManifest(
        owner,
        manifest,
        host ?? null,
        deps.maxConcurrentCeiling,
        resume,
      );
      if (renewed === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${manifest.name} is no longer the registration this worker served`,
        });
      return renewed;
    },

    async claim(owner: string, input: ClaimInput): Promise<WorkItem[]> {
      const deadline = now().getTime() + (input.waitMs ?? 0);

      for (;;) {
        const satellite = await deps.repo.get(owner, input.satellite);
        if (
          satellite === null ||
          (input.incarnation !== undefined &&
            satellite.incarnation !== input.incarnation)
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "unknown satellite",
          });
        if (satellite.draining)
          await deps.repo.setDraining(
            owner,
            input.satellite,
            false,
            input.incarnation,
          );

        await deps.repo.touch(owner, input.satellite, input.incarnation);

        const cancels = await deps.repo.takeCancellations(
          owner,
          input.satellite,
          new Date(now().getTime() - LEASE_MS),
          input.incarnation,
        );
        const items: WorkItem[] = cancels.map((job) => ({
          kind: "cancel",
          sequence: job.sequence,
          tool: job.tool,
          args: job.args,
        }));

        const claimed = await deps.repo.claimQueued(
          owner,
          input.satellite,
          input.capacity,
          new Date(now().getTime() + LEASE_MS),
          input.incarnation,
        );
        const names = await Promise.all(
          claimed.map(({ job }) =>
            (deps.agentName?.(job.agentId) ?? Promise.resolve(null)).catch(
              () => null,
            ),
          ),
        );
        const transfers = new Set(
          satellite.tools
            .filter((tool) => tool.transfer !== undefined)
            .map((tool) => tool.name),
        );
        for (const [index, { job, transferToken }] of claimed.entries())
          items.push({
            kind: "call",
            sequence: job.sequence,
            tool: job.tool,
            args: job.args,
            agent: { id: job.agentId, name: names[index] ?? null },
            ...(transfers.has(job.tool) ? { transferToken } : {}),
          });

        if (items.length > 0 || now().getTime() >= deadline) return items;
        await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
      }
    },

    async heartbeat(owner: string, input: HeartbeatInput): Promise<void> {
      const satellite = await deps.repo.get(owner, input.satellite);
      if (
        satellite === null ||
        (input.incarnation !== undefined &&
          satellite.incarnation !== input.incarnation)
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "unknown satellite",
        });
      await deps.repo.touch(owner, input.satellite, input.incarnation);
      await deps.repo.renewLeases(
        owner,
        input.satellite,
        input.running,
        new Date(now().getTime() + LEASE_MS),
        input.incarnation,
      );
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Records what a Job came to. A worker names the
     * registration it claimed the Job under, and a report that names another
     * one is dropped: removing a Satellite deletes its Jobs and restarts the
     * sequence, so the old machine's #1 and the new machine's #1 are different
     * Jobs, and settling one with the other's outcome would be a lie.
     */
    async report(owner: string, input: ReportInput): Promise<void> {
      const written = {
        output: input.outcome.output,
        truncated: input.outcome.truncated,
      };
      const patch =
        input.outcome.status === "done"
          ? {
              status: "done" as const,
              isError: input.outcome.isError,
              exitCode: input.outcome.exitCode,
              ...written,
              images: input.outcome.images,
            }
          : input.outcome.status === "cancelled"
            ? { status: "cancelled" as const, reason: "cancelled", ...written }
            : {
                status: "interrupted" as const,
                reason: input.outcome.reason,
                ...written,
              };

      const settled = await deps.repo.settle(
        owner,
        input.satellite,
        input.sequence,
        patch,
        "running",
        input.incarnation,
      );
      if (settled === null) return;
      await deps.deliverOutcome({
        owner,
        agentId: settled.agentId,
        satellite: input.satellite,
        sequence: input.sequence,
      });
    },

    async drain(
      owner: string,
      satellite: string,
      incarnation?: string,
    ): Promise<void> {
      if (incarnation !== undefined) {
        const existing = await deps.repo.get(owner, satellite);
        if (existing === null || existing.incarnation !== incarnation)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "unknown satellite",
          });
      }
      await deps.repo.setDraining(owner, satellite, true, incarnation);
    },
  };
}

export function createLeaseSweep(deps: WorkerOpsDeps) {
  const now = deps.now ?? (() => new Date());
  return async (): Promise<number> => {
    let expired: JobRow[] = [];
    try {
      for (const job of await deps.repo.stopDispatch(
        {},
        "it waited past its expiry without ever starting",
        STALE_JOB_TTL_MS,
        now(),
      )) {
        try {
          await deps.deliverOutcome({
            owner: job.owner,
            agentId: job.agentId,
            satellite: job.satellite,
            sequence: job.sequence,
          });
        } catch (err) {
          console.error(
            `[satellites] ${job.satellite}#${job.sequence} expired unstarted but its agent was not told`,
            err,
          );
        }
      }

      const at = now();
      expired = await deps.repo.expiredLeases(at);
      for (const job of expired) {
        try {
          const settled = await deps.repo.settle(
            job.owner,
            job.satellite,
            job.sequence,
            {
              status: "interrupted",
              reason: `${formatJobRef(job.satellite, job.sequence)} lost its worker; the command may have completed`,
            },
            "running",
            undefined,
            at,
          );
          if (settled === null) continue;
          await deps.deliverOutcome({
            owner: job.owner,
            agentId: job.agentId,
            satellite: job.satellite,
            sequence: job.sequence,
          });
        } catch (err) {
          console.error(
            `[satellites] ${job.satellite}#${job.sequence} lost its worker but was not settled`,
            err,
          );
        }
      }
    } finally {
      await deps.repo.purgeExpired(now());
    }
    return expired.length;
  };
}

export type SatelliteWorkerOpsImpl = ReturnType<
  typeof createSatelliteWorkerOps
>;
