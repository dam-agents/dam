import { TRPCError } from "@trpc/server";
import {
  INLINE_OUTPUT_LIMIT,
  formatJobRef,
  type JobOutcome,
  type JobStarted,
  type SatelliteView,
} from "api-server-api";
import { admit, isOnline } from "../domain/admission.js";
import { isTerminal, type JobRow, type SatelliteRow } from "../domain/types.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

export const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const POLL_INTERVAL_MS = 500;
const CANCEL_ATTEMPTS = 3;
const AWAIT_LEASE_MS = POLL_INTERVAL_MS * 4;

export interface AgentOpsDeps {
  repo: SatellitesRepository;
  ownerOf: (agentId: string) => Promise<string | null>;
  spillLog: (
    agentId: string,
    ref: string,
    output: string,
  ) => Promise<string | null>;
  retireApproval: (approvalId: string) => Promise<void>;
  now?: () => Date;
}

function view(
  satellite: SatelliteRow,
  active: number,
  now: Date,
): SatelliteView {
  return {
    name: satellite.name,
    description: satellite.description,
    host: satellite.host,
    online: isOnline(satellite, now),
    draining: satellite.draining,
    lastSeenAt: satellite.lastSeenAt?.toISOString() ?? null,
    tools: satellite.tools,
    maxConcurrent: satellite.maxConcurrent,
    activeJobs: active,
    grantedAgentIds: [],
  };
}

export function createSatelliteAgentOps(deps: AgentOpsDeps) {
  const now = deps.now ?? (() => new Date());

  async function resolve(
    agentId: string,
    name: string,
  ): Promise<{ owner: string; satellite: SatelliteRow }> {
    const owner = await deps.ownerOf(agentId);
    if (owner === null)
      throw new TRPCError({ code: "NOT_FOUND", message: "unknown agent" });
    const granted = await deps.repo.grantedNames(agentId);
    if (!granted.some((g) => g.owner === owner && g.name === name))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `this agent has no access to a satellite called "${name}"`,
      });
    const satellite = await deps.repo.get(owner, name);
    if (satellite === null)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no satellite "${name}"`,
      });
    return { owner, satellite };
  }

  async function outcome(agentId: string, job: JobRow): Promise<JobOutcome> {
    const ref = formatJobRef(job.satellite, job.sequence);
    let output = job.output;
    let outputPath: string | null = null;
    if (output !== null && output.length > INLINE_OUTPUT_LIMIT) {
      outputPath = await deps.spillLog(agentId, ref, output);
      if (outputPath !== null) output = null;
    }
    return {
      ref,
      status: job.status,
      isError: job.isError,
      exitCode: job.exitCode,
      output,
      outputPath,
      truncated: job.truncated,
      reason: job.reason,
    };
  }

  async function readClaiming(
    agentId: string,
    name: string,
    sequence: number,
  ): Promise<{ outcome: JobOutcome; claimed: boolean }> {
    const { owner } = await resolve(agentId, name);
    const job = await deps.repo.getJob(owner, name, sequence);
    if (job === null || job.agentId !== agentId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no job ${formatJobRef(name, sequence)} belongs to this agent`,
      });
    const claimed = isTerminal(job.status)
      ? await deps.repo.markSeen(agentId, name, sequence)
      : false;
    return { outcome: await outcome(agentId, job), claimed };
  }

  async function read(
    agentId: string,
    name: string,
    sequence: number,
  ): Promise<JobOutcome> {
    return (await readClaiming(agentId, name, sequence)).outcome;
  }

  return {
    async granted(agentId: string): Promise<SatelliteView[]> {
      const at = now();
      const names = await deps.repo.grantedNames(agentId);
      const views: SatelliteView[] = [];
      for (const { owner, name } of names) {
        const satellite = await deps.repo.get(owner, name);
        if (satellite === null) continue;
        const active = await deps.repo.activeJobs(owner, name);
        views.push(view(satellite, active.length, at));
      }
      return views;
    },

    async start(
      agentId: string,
      name: string,
      tool: string,
      args: Record<string, unknown>,
    ): Promise<JobStarted> {
      const at = now();
      const { owner, satellite } = await resolve(agentId, name);

      const active = await deps.repo.activeJobs(owner, name);
      const byTool = new Map<string, number>();
      for (const job of active)
        byTool.set(job.tool, (byTool.get(job.tool) ?? 0) + 1);

      const verdict = admit(
        satellite,
        tool,
        { total: active.length, byTool },
        at,
      );
      if (!verdict.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: verdict.reason });

      const inserted = await deps.repo.insertJob({
        owner,
        satellite: name,
        agentId,
        tool,
        args,
        status: "queued",
        expiresAt: new Date(at.getTime() + JOB_TTL_MS),
        maxConcurrent: satellite.maxConcurrent,
        toolMax: verdict.toolMax,
      });
      if ("full" in inserted)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            inserted.total >= satellite.maxConcurrent
              ? `${name} is running ${inserted.total} jobs (max ${satellite.maxConcurrent}) — wait for one to finish`
              : `${tool} already has ${inserted.forTool} running (max ${verdict.toolMax}) — wait for one to finish`,
        });
      return {
        ref: formatJobRef(name, inserted.sequence),
        satellite: name,
        sequence: inserted.sequence,
        status: "queued",
      };
    },

    read,

    async wait(
      agentId: string,
      name: string,
      sequence: number,
      deadlineMs: number,
    ): Promise<JobOutcome> {
      const deadline = now().getTime() + deadlineMs;
      for (;;) {
        await deps.repo.markAwaited(
          agentId,
          name,
          sequence,
          new Date(now().getTime() + AWAIT_LEASE_MS),
        );
        const current = await readClaiming(agentId, name, sequence);
        if (isTerminal(current.outcome.status)) {
          if (!current.claimed)
            await deps.repo.releaseAwaited(agentId, name, sequence);
          return current.outcome;
        }
        if (now().getTime() >= deadline) return current.outcome;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },

    async cancel(
      agentId: string,
      name: string,
      sequence: number,
    ): Promise<JobOutcome> {
      const { owner } = await resolve(agentId, name);
      let job: JobRow | null = null;
      for (let attempt = 0; attempt < CANCEL_ATTEMPTS; attempt++) {
        job = await deps.repo.getJob(owner, name, sequence);
        if (job === null || job.agentId !== agentId)
          throw new TRPCError({ code: "NOT_FOUND", message: "no such job" });

        if (isTerminal(job.status)) {
          await deps.repo.markSeen(agentId, name, sequence);
          return outcome(agentId, job);
        }
        if (job.status === "running") {
          await deps.repo.requestCancel(owner, name, sequence);
          return outcome(agentId, { ...job, reason: "cancellation requested" });
        }
        const settled = await deps.repo.settle(
          owner,
          name,
          sequence,
          { status: "cancelled", reason: "cancelled before it started" },
          job.status,
        );
        if (settled === null) continue;
        if (job.approvalId !== null) await deps.retireApproval(job.approvalId);
        await deps.repo.markSeen(agentId, name, sequence);
        return outcome(agentId, settled);
      }
      return outcome(agentId, job!);
    },
  };
}

export type SatelliteAgentOpsImpl = ReturnType<typeof createSatelliteAgentOps>;
