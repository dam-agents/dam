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

/**
 * Make an agent's pod reachable for a skills-management call, or fail clearly.
 * Fast-fails on a known error state (waking is hopeless); otherwise wakes via
 * the reachability primitive and maps its timeout/error into a clean
 * TRPCError so the caller never sees a raw Error and never hangs. Returns the
 * fetched agent so callers that need the spec (e.g. publish → skillPaths) skip
 * a second get.
 */
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
    // A hard wake-failure cause (pod crash, bad image, reconcile error) is a
    // precondition the caller must fix, not a server fault.
    const hardFailure =
      isAgentWakeTimeoutError(err) && !isTransientWakeFailure(err.failure);
    throw new TRPCError({
      code: hardFailure ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR",
      message: `agent could not be made ready: ${(err as Error).message}`,
    });
  }
  return infra;
}
