import { TRPCError } from "@trpc/server";
import type {
  ActiveArm,
  Experiment,
  ExperimentAddArmInput,
  ExperimentArm,
  ExperimentCreateInput,
  ExperimentFinishArmInput,
  ExperimentListItem,
  ExperimentRecordRunInput,
  ExperimentRun,
  ExperimentsService,
  ExperimentWithRuns,
} from "api-server-api";
import type { ExperimentsRepository } from "../infrastructure/experiments-repository.js";
import type { TrialLauncher } from "../infrastructure/trial-launcher.js";
import { rollupExperiment } from "../domain/experiment-rollup.js";
import { buildTrialPrompt } from "../domain/trial-prompt.js";
import { securityLog } from "../../../core/security-log.js";
import { isUniqueViolation } from "../../../core/db-errors.js";

export function createExperimentsService(deps: {
  owner: string;
  repo: ExperimentsRepository;
  agentExists?: (agentId: string) => Promise<boolean>;
  trialLauncher?: TrialLauncher;
}): ExperimentsService {
  async function ensureAgent(agentId: string): Promise<void> {
    if (!deps.agentExists) return;
    const ok = await deps.agentExists(agentId);
    if (!ok) {
      securityLog("warn", "experiment.arm_add", {
        category: "authz",
        actor: deps.owner,
        actorKind: "user",
        agentId,
        decision: "deny",
        reason: "agent-not-owned",
        result: "failure",
      });
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Agent "${agentId}" not found`,
      });
    }
  }

  async function launchTrials(experiment: Experiment): Promise<void> {
    if (!deps.trialLauncher) return;
    const launcher = deps.trialLauncher;
    const arms = await deps.repo.listArms(experiment.id);
    for (const arm of arms) {
      if (arm.status !== "running") continue;
      const task = buildTrialPrompt({
        prompt: experiment.prompt,
        armVariation: arm.armVariation,
      });
      try {
        await launcher.launch({
          agentId: arm.agentId,
          experimentId: experiment.id,
          task,
        });
      } catch (err) {
        securityLog("warn", "experiment.trial_launch", {
          category: "resource",
          actor: deps.owner,
          actorKind: "user",
          agentId: arm.agentId,
          target: experiment.id,
          result: "failure",
          reason: (err as Error).message,
        });
        // A Trial that never launched can never report or finish; fail the arm
        // now rather than leave it to time out on the inactivity sweep.
        await deps.repo.failLaunch(experiment.id, arm.agentId);
      }
    }
  }

  return {
    list: (): Promise<ExperimentListItem[]> =>
      deps.repo.listByOwner(deps.owner),

    async getWithRuns(id): Promise<ExperimentWithRuns | null> {
      const experiment = await deps.repo.get(id, deps.owner);
      if (!experiment) return null;
      const [arms, runs] = await Promise.all([
        deps.repo.listArms(id),
        deps.repo.listRuns(id),
      ]);
      return rollupExperiment(experiment, arms, runs);
    },

    async create(input: ExperimentCreateInput): Promise<Experiment> {
      try {
        const experiment = await deps.repo.create({
          ownerId: deps.owner,
          name: input.name,
          prompt: input.prompt,
        });
        securityLog("info", "experiment.create", {
          category: "resource",
          actor: deps.owner,
          actorKind: "user",
          target: experiment.id,
          result: "success",
        });
        return experiment;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `An experiment named "${input.name}" already exists. Names must be unique per user.`,
          });
        }
        throw err;
      }
    },

    async addArm(input: ExperimentAddArmInput): Promise<ExperimentArm> {
      const experiment = await deps.repo.get(input.experimentId, deps.owner);
      if (!experiment) throw new TRPCError({ code: "NOT_FOUND" });
      await ensureAgent(input.agentId);
      try {
        const arm = await deps.repo.addArm({
          experimentId: input.experimentId,
          agentId: input.agentId,
          armVariation: input.armVariation,
        });
        securityLog("info", "experiment.arm_add", {
          category: "resource",
          actor: deps.owner,
          actorKind: "user",
          agentId: input.agentId,
          target: input.experimentId,
          result: "success",
        });
        return arm;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Agent "${input.agentId}" is already an arm of this experiment.`,
          });
        }
        throw err;
      }
    },

    async start(id): Promise<Experiment> {
      const experiment = await deps.repo.get(id, deps.owner);
      if (!experiment) throw new TRPCError({ code: "NOT_FOUND" });
      if (experiment.status === "completed") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A completed experiment cannot be started again.",
        });
      }
      if (experiment.status === "running") return experiment;
      const updated = await deps.repo.updateStatus(id, deps.owner, "running");
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      await deps.repo.markArmsRunning(id);
      await launchTrials(updated);
      securityLog("info", "experiment.start", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        target: id,
        result: "success",
      });
      // launchTrials may have failed every arm (all launches threw), which
      // flips the experiment straight to `completed` — re-read so the caller
      // sees the settled status, not the stale `running` snapshot.
      return (await deps.repo.get(id, deps.owner)) ?? updated;
    },

    async stop(id): Promise<Experiment> {
      const experiment = await deps.repo.get(id, deps.owner);
      if (!experiment) throw new TRPCError({ code: "NOT_FOUND" });
      if (experiment.status !== "running") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Only a running experiment can be stopped (status: ${experiment.status}).`,
        });
      }
      const updated = await deps.repo.stop(id, deps.owner);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      securityLog("info", "experiment.stop", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        target: id,
        result: "success",
      });
      return updated;
    },

    async delete(id): Promise<void> {
      await deps.repo.delete(id, deps.owner);
      securityLog("info", "experiment.delete", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        target: id,
        result: "success",
      });
    },

    async resolveActiveArm(agentId): Promise<ActiveArm | null> {
      const found = await deps.repo.findActiveArm(agentId, deps.owner);
      if (!found) return null;
      const { experiment, arm } = found;
      return {
        experimentId: experiment.id,
        experimentName: experiment.name,
        prompt: experiment.prompt,
        agentId: arm.agentId,
        armVariation: arm.armVariation,
      };
    },

    async recordRun(input: ExperimentRecordRunInput): Promise<ExperimentRun> {
      const run = await deps.repo.addRun({
        experimentId: input.experimentId,
        agentId: input.agentId,
        sessionId: input.sessionId,
        candidateRef: input.candidateRef,
        score: input.score,
        status: "completed",
      });
      if (!run) {
        // The arm finished, was stopped, or the experiment ended between
        // attribution and the insert. The ledger is closed for this arm.
        securityLog("warn", "experiment.record_run", {
          category: "resource",
          actor: input.agentId,
          actorKind: "agent",
          surface: "mcp",
          agentId: input.agentId,
          target: input.experimentId,
          result: "failure",
          reason: "arm-not-running",
        });
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This agent is not an active arm of a running experiment; the run ledger is closed.",
        });
      }
      securityLog("info", "experiment.record_run", {
        category: "resource",
        actor: input.agentId,
        actorKind: "agent",
        surface: "mcp",
        agentId: input.agentId,
        target: input.experimentId,
        result: "success",
        detail: { runNumber: run.runNumber },
      });
      return run;
    },

    async finishArm(input: ExperimentFinishArmInput): Promise<ExperimentArm> {
      const arm = await deps.repo.finishArm(input.experimentId, input.agentId);
      if (!arm) {
        securityLog("warn", "experiment.finish_arm", {
          category: "resource",
          actor: input.agentId,
          actorKind: "agent",
          surface: "mcp",
          agentId: input.agentId,
          target: input.experimentId,
          result: "failure",
          reason: "arm-not-running",
        });
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This agent is not an active arm of a running experiment; there is nothing to finish.",
        });
      }
      securityLog("info", "experiment.finish_arm", {
        category: "resource",
        actor: input.agentId,
        actorKind: "agent",
        surface: "mcp",
        agentId: input.agentId,
        target: input.experimentId,
        result: "success",
        detail: { status: arm.status },
      });
      return arm;
    },
  };
}
