import { TRPCError } from "@trpc/server";
import type {
  ActiveArm,
  Experiment,
  ExperimentAddArmInput,
  ExperimentArm,
  ExperimentCreateInput,
  ExperimentsService,
  ExperimentWithRuns,
} from "api-server-api";
import type { ExperimentsRepository } from "../infrastructure/experiments-repository.js";
import { rollupExperiment } from "../domain/experiment-rollup.js";
import { securityLog } from "../../../core/security-log.js";
import { isUniqueViolation } from "../../../core/db-errors.js";

export function createExperimentsService(deps: {
  owner: string;
  repo: ExperimentsRepository;
  agentExists?: (agentId: string) => Promise<boolean>;
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

  return {
    list: (): Promise<Experiment[]> => deps.repo.listByOwner(deps.owner),

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
          goal: input.goal,
          spec: input.spec,
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
          armSpec: input.armSpec,
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
      securityLog("info", "experiment.start", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        target: id,
        result: "success",
      });
      return updated;
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
      const updated = await deps.repo.updateStatus(id, deps.owner, "stopped");
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
        goal: experiment.goal,
        spec: experiment.spec,
        agentId: arm.agentId,
        armSpec: arm.armSpec,
      };
    },
  };
}
