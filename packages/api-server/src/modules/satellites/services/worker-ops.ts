import { TRPCError } from "@trpc/server";
import {
  formatJobRef,
  type ClaimInput,
  type HeartbeatInput,
  type ReportInput,
  type SatelliteManifest,
  type WorkItem,
} from "api-server-api";
import { compileCommands } from "../domain/admission.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

export const LEASE_MS = 60_000;
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
  now?: () => Date;
}

export function createSatelliteWorkerOps(deps: WorkerOpsDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async connect(
      owner: string,
      manifest: SatelliteManifest,
      host?: string,
    ): Promise<void> {
      const compiled = compileCommands(manifest.commands);
      if (!compiled.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: compiled.error });
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

      for (;;) {
        await deps.repo.touch(owner, input.satellite);

        const cancels = await deps.repo.takeCancellations(
          owner,
          input.satellite,
        );
        const items: WorkItem[] = cancels.map((job) => ({
          kind: "cancel",
          sequence: job.sequence,
          cmd: job.cmd,
          timeoutMs: null,
        }));

        const claimed = await deps.repo.claimQueued(
          owner,
          input.satellite,
          input.capacity,
          new Date(now().getTime() + LEASE_MS),
        );
        for (const job of claimed)
          items.push({
            kind: "run",
            sequence: job.sequence,
            cmd: job.cmd,
            timeoutMs: null,
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
      const patch =
        input.outcome.status === "done"
          ? {
              status: "done" as const,
              exitCode: input.outcome.exitCode,
              output: input.outcome.output,
              truncated: input.outcome.truncated,
            }
          : input.outcome.status === "cancelled"
            ? { status: "cancelled" as const, reason: "cancelled" }
            : { status: "interrupted" as const, reason: input.outcome.reason };

      const settled = await deps.repo.settle(
        owner,
        input.satellite,
        input.sequence,
        patch,
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
    const expired = await deps.repo.expiredLeases(now());
    for (const job of expired) {
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
    }
    await deps.repo.purgeExpired(now());
    return expired.length;
  };
}

export type SatelliteWorkerOpsImpl = ReturnType<
  typeof createSatelliteWorkerOps
>;
