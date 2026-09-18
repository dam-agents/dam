import { TRPCError } from "@trpc/server";
import {
  INLINE_OUTPUT_LIMIT,
  formatJobRef,
  type JobOutcome,
  type JobStarted,
  type SatelliteView,
} from "api-server-api";
import { argvRefusal, regexSources } from "api-server-api";
import { admit, compileCommands, isOnline } from "../domain/admission.js";
import {
  createRegexEvaluator,
  RegexDeadlineError,
  type RegexEvaluator,
} from "../infrastructure/regex-worker.js";
import { isTerminal, type JobRow, type SatelliteRow } from "../domain/types.js";
import type { SatellitesRepository } from "../infrastructure/satellites-repository.js";

export const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const POLL_INTERVAL_MS = 500;

export interface AgentOpsDeps {
  repo: SatellitesRepository;
  ownerOf: (agentId: string) => Promise<string | null>;
  requestApproval: (input: {
    agentId: string;
    owner: string;
    satellite: string;
    sequence: number;
    ref: string;
    cmd: string[];
  }) => Promise<string>;
  spillLog: (
    agentId: string,
    ref: string,
    output: string,
  ) => Promise<string | null>;
  retireApproval: (approvalId: string) => Promise<void>;
  regexEvaluator?: RegexEvaluator;
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
    commands: satellite.commands,
    maxConcurrent: satellite.maxConcurrent,
    activeJobs: active,
    grantedAgentIds: [],
  };
}

export function createSatelliteAgentOps(deps: AgentOpsDeps) {
  const now = deps.now ?? (() => new Date());
  const evaluator = deps.regexEvaluator ?? createRegexEvaluator();

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
      exitCode: job.exitCode,
      output,
      outputPath,
      truncated: job.truncated,
      reason: job.reason,
    };
  }

  async function read(
    agentId: string,
    name: string,
    sequence: number,
  ): Promise<JobOutcome> {
    const { owner } = await resolve(agentId, name);
    const job = await deps.repo.getJob(owner, name, sequence);
    if (job === null || job.agentId !== agentId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no job ${formatJobRef(name, sequence)} belongs to this agent`,
      });
    if (isTerminal(job.status)) await deps.repo.markSeen(owner, name, sequence);
    return outcome(agentId, job);
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
      cmd: string[],
    ): Promise<JobStarted> {
      const oversize = argvRefusal(cmd);
      if (oversize !== null)
        throw new TRPCError({ code: "BAD_REQUEST", message: oversize });

      const at = now();
      const { owner, satellite } = await resolve(agentId, name);
      const compiled = compileCommands(satellite.commands);
      if (!compiled.ok)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${name}'s command patterns do not parse: ${compiled.error}`,
        });

      const active = await deps.repo.activeJobs(owner, name);
      const byPattern = new Map<string, number>();
      for (const job of active)
        byPattern.set(job.pattern, (byPattern.get(job.pattern) ?? 0) + 1);

      let oracle;
      try {
        oracle = await evaluator.oracleFor(
          regexSources(compiled.commands.map((c) => c.parsed)),
          cmd,
        );
      } catch (err) {
        if (err instanceof RegexDeadlineError)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${name} has a command pattern whose regex takes too long on this command — narrow the pattern`,
          });
        console.error("[satellites] regex evaluation failed", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "could not check this command against the manifest",
        });
      }

      const verdict = admit(
        satellite,
        compiled.commands,
        cmd,
        { total: active.length, byPattern },
        at,
        oracle,
      );
      if (!verdict.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: verdict.reason });

      const inserted = await deps.repo.insertJob({
        owner,
        satellite: name,
        agentId,
        cmd,
        pattern: verdict.pattern,
        status: verdict.status,
        expiresAt: new Date(at.getTime() + JOB_TTL_MS),
        maxConcurrent: satellite.maxConcurrent,
        patternMax: verdict.patternMax,
      });
      if ("full" in inserted)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            inserted.total >= satellite.maxConcurrent
              ? `${name} is running ${inserted.total} jobs (max ${satellite.maxConcurrent}) — wait for one to finish`
              : `${verdict.pattern} already has ${inserted.forPattern} running (max ${verdict.patternMax}) — wait for one to finish`,
        });
      const job = inserted;
      const ref = formatJobRef(name, job.sequence);
      if (verdict.status === "pending-approval") {
        const approvalId = await deps.requestApproval({
          agentId,
          owner,
          satellite: name,
          sequence: job.sequence,
          ref,
          cmd,
        });
        await deps.repo.setApprovalId(owner, name, job.sequence, approvalId);
      }
      return {
        ref,
        satellite: name,
        sequence: job.sequence,
        status:
          verdict.status === "pending-approval" ? "pending-approval" : "queued",
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
        const current = await read(agentId, name, sequence);
        if (isTerminal(current.status)) return current;
        if (now().getTime() >= deadline) return current;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },

    async cancel(
      agentId: string,
      name: string,
      sequence: number,
    ): Promise<JobOutcome> {
      const { owner } = await resolve(agentId, name);
      const job = await deps.repo.getJob(owner, name, sequence);
      if (job === null || job.agentId !== agentId)
        throw new TRPCError({ code: "NOT_FOUND", message: "no such job" });

      if (isTerminal(job.status)) {
        await deps.repo.markSeen(owner, name, sequence);
        return outcome(agentId, job);
      }
      if (job.status === "running") {
        await deps.repo.requestCancel(owner, name, sequence);
        return outcome(agentId, { ...job, reason: "cancellation requested" });
      }
      const settled = await deps.repo.settle(owner, name, sequence, {
        status: "cancelled",
        reason: "cancelled before it started",
      });
      if (job.approvalId !== null) await deps.retireApproval(job.approvalId);
      await deps.repo.markSeen(owner, name, sequence);
      return outcome(agentId, settled ?? job);
    },
  };
}

export type SatelliteAgentOpsImpl = ReturnType<typeof createSatelliteAgentOps>;
