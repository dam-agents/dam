import { TRPCError } from "@trpc/server";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import {
  computeAgentState,
  type InfraAgent,
} from "../../agents/infrastructure/agent-mappers.js";
import {
  isAgentWakeTimeoutError,
  isTransientWakeFailure,
} from "../../agents/index.js";

export async function ensureAgentReachable(
  repo: AgentsRepository,
  agentId: string,
  owner: string,
): Promise<InfraAgent> {
  const infra = await repo.get(agentId, owner);
  if (!infra) {
    throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
  }
  if (computeAgentState(infra) === "error") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "agent is in an error state and can't be reached; resolve the error before managing skills",
    });
  }
  try {
    await repo.ensureReady(agentId);
  } catch (err) {
    const hardFailure =
      isAgentWakeTimeoutError(err) && !isTransientWakeFailure(err.failure);
    throw new TRPCError({
      code: hardFailure ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR",
      message: `agent could not be made ready: ${(err as Error).message}`,
    });
  }
  return infra;
}
