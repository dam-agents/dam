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
  requestApproval: (input: {
    agentId: string;
    owner: string;
    satellite: string;
    sequence: number;
    ref: string;
    tool: string;
    args: Record<string, unknown>;
    reason: string;
  }) => Promise<string>;
  deliverOutcome: (input: {
    owner: string;
    agentId: string;
    satellite: string;
    sequence: number;
  }) => Promise<void>;
  now?: () => Date;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Satellite side of the queue — connect, claim,
 * heartbeat, report, drain. It moves MCP tool calls out and outcomes back and
 * never reads either: only the machine knows what its arguments mean.
 *
 * A report of `needs-approval` is the one non-terminal outcome. The machine is
 * saying its own policy wants a human for this call, which the platform could
 * not have known — it sees one tool, not the Command Patterns behind it. The Job
 * is parked rather than settled, the approval is raised here, and a verdict
 * requeues it marked approved so the machine does not ask twice.
 */
export function createSatelliteWorkerOps(deps: WorkerOpsDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async connect(
      owner: string,
      manifest: SatelliteManifest,
      host?: string,
    ): Promise<void> {
      await deps.repo.upsertFromManifest(
        owner,
        manifest,
        host ?? null,
        deps.maxConcurrentCeiling,
      );
    },

    async claim(owner: string, input: ClaimInput): Promise<WorkItem[]> {
      const satellite = await deps.repo.get(owner, input.satellite);
      if (satellite === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "unknown satellite",
        });
      const deadline = now().getTime() + (input.waitMs ?? 0);

      if (satellite.draining)
        await deps.repo.setDraining(owner, input.satellite, false);

      for (;;) {
        await deps.repo.touch(owner, input.satellite);

        const cancels = await deps.repo.takeCancellations(
          owner,
          input.satellite,
          new Date(now().getTime() - LEASE_MS),
        );
        const items: WorkItem[] = cancels.map((job) => ({
          kind: "cancel",
          sequence: job.sequence,
          tool: job.tool,
          args: job.args,
          approved: job.approved,
        }));

        const claimed = await deps.repo.claimQueued(
          owner,
          input.satellite,
          input.capacity,
          new Date(now().getTime() + LEASE_MS),
        );
        for (const job of claimed)
          items.push({
            kind: "call",
            sequence: job.sequence,
            tool: job.tool,
            args: job.args,
            approved: job.approved,
          });

        if (items.length > 0 || now().getTime() >= deadline) return items;
        await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
      }
    },

    async heartbeat(owner: string, input: HeartbeatInput): Promise<void> {
      await deps.repo.touch(owner, input.satellite);
      await deps.repo.renewLeases(
        owner,
        input.satellite,
        input.running,
        new Date(now().getTime() + LEASE_MS),
      );
    },

    async report(owner: string, input: ReportInput): Promise<void> {
      if (input.outcome.status === "needs-approval") {
        const held = await deps.repo.hold(
          owner,
          input.satellite,
          input.sequence,
        );
        if (held === null) return;
        const approvalId = await deps.requestApproval({
          agentId: held.agentId,
          owner,
          satellite: input.satellite,
          sequence: input.sequence,
          ref: formatJobRef(input.satellite, input.sequence),
          tool: held.tool,
          args: held.args,
          reason: input.outcome.reason,
        });
        await deps.repo.setApprovalId(
          owner,
          input.satellite,
          input.sequence,
          approvalId,
        );
        return;
      }

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
      );
      if (settled === null) return;
      await deps.deliverOutcome({
        owner,
        agentId: settled.agentId,
        satellite: input.satellite,
        sequence: input.sequence,
      });
    },

    async drain(owner: string, satellite: string): Promise<void> {
      await deps.repo.setDraining(owner, satellite, true);
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

      expired = await deps.repo.expiredLeases(now());
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
