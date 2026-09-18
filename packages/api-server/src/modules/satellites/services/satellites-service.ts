import { TRPCError } from "@trpc/server";
import {
  formatJobRef,
  type JobView,
  type SatelliteView,
  type SatellitesService,
} from "api-server-api";
import { isOnline } from "../domain/admission.js";
import { isTerminal } from "../domain/types.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

export interface SatellitesServiceDeps {
  repo: SatellitesRepository;
  owner: string;
  isAgentOwnedBy: (agentId: string, owner: string) => Promise<boolean>;
  deliverOutcome: (input: {
    owner: string;
    agentId: string;
    satellite: string;
    sequence: number;
  }) => Promise<void>;
  stopDispatch: (
    scope: { satellite?: string; agentId?: string },
    reason: string,
  ) => Promise<void>;
  retireApproval: (approvalId: string) => Promise<void>;
  now?: () => Date;
}

export function createSatellitesService(
  deps: SatellitesServiceDeps,
): SatellitesService {
  const now = deps.now ?? (() => new Date());

  async function mustExist(name: string): Promise<void> {
    if ((await deps.repo.get(deps.owner, name)) === null)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no satellite "${name}"`,
      });
  }

  return {
    async list(): Promise<SatelliteView[]> {
      const at = now();
      const rows = await deps.repo.listForOwner(deps.owner);
      return Promise.all(
        rows.map(async (row) => ({
          name: row.name,
          description: row.description,
          host: row.host,
          online: isOnline(row, at),
          draining: row.draining,
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          commands: row.commands,
          maxConcurrent: row.maxConcurrent,
          activeJobs: (await deps.repo.activeJobs(deps.owner, row.name)).length,
          grantedAgentIds: await deps.repo.grantedAgentIds(
            deps.owner,
            row.name,
          ),
        })),
      );
    },

    async remove(name: string): Promise<void> {
      await mustExist(name);
      await deps.stopDispatch({ satellite: name }, "satellite removed");
      await deps.repo.remove(deps.owner, name);
    },

    async grant(name: string, agentId: string): Promise<void> {
      await mustExist(name);
      if (!(await deps.isAgentOwnedBy(agentId, deps.owner)))
        throw new TRPCError({ code: "FORBIDDEN", message: "not your agent" });
      await deps.repo.grant(deps.owner, name, agentId);
    },

    async revoke(name: string, agentId: string): Promise<void> {
      await mustExist(name);
      await deps.repo.revoke(deps.owner, name, agentId);
      await deps.stopDispatch(
        { satellite: name, agentId },
        "the agent's access to this satellite was revoked",
      );
    },

    async listJobs(name: string): Promise<JobView[]> {
      await mustExist(name);
      const jobs = await deps.repo.listJobs(deps.owner, name);
      return jobs.map((job) => ({
        satellite: job.satellite,
        sequence: job.sequence,
        ref: formatJobRef(job.satellite, job.sequence),
        agentId: job.agentId,
        cmd: job.cmd,
        status: job.status,
        exitCode: job.exitCode,
        startedAt: job.startedAt?.toISOString() ?? null,
        endedAt: job.endedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
      }));
    },

    async cancelJob(name: string, sequence: number): Promise<void> {
      await mustExist(name);
      const job = await deps.repo.getJob(deps.owner, name, sequence);
      if (job === null)
        throw new TRPCError({ code: "NOT_FOUND", message: "no such job" });
      if (isTerminal(job.status)) return;
      if (job.status === "running") {
        await deps.repo.requestCancel(deps.owner, name, sequence);
        return;
      }
      const settled = await deps.repo.settle(deps.owner, name, sequence, {
        status: "cancelled",
        reason: "cancelled before it started",
      });
      if (job.approvalId !== null) await deps.retireApproval(job.approvalId);
      if (settled !== null)
        await deps.deliverOutcome({
          owner: deps.owner,
          agentId: settled.agentId,
          satellite: name,
          sequence,
        });
    },
  };
}
