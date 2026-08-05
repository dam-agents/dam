import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import { computeAgentState } from "../../agents/infrastructure/agent-mappers.js";
import type { PodPrStateReader } from "../domain/pr-state.js";
import type { AgentRuntimeSkillsClient } from "./agent-runtime-client.js";

/**
 * Resolves a pull request through the agent's own pod, whose paired gateway
 * injects the owner's GitHub token — the only path that can see a private
 * source's pull request.
 *
 * Best-effort on purpose, and the guarantee that makes that acceptable is
 * negative: **this never wakes a hibernated agent.** A badge is not worth
 * spending the user's compute on something they did not ask for, so a sleeping
 * sandbox simply yields null and the badge keeps claiming less. What rescues
 * accuracy over time is terminal-state persistence — if the pod happens to be
 * warm when the pull request reaches a terminal state, that state is captured
 * once and kept forever, so the badge only ever gets more accurate.
 */
export function createPodPrStateReader(deps: {
  agents: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  log: (msg: string) => void;
}): PodPrStateReader {
  return {
    async read(agentId, coords) {
      // No owner: this is background work sweeping every agent's records.
      const infra = await deps.agents.get(agentId);
      // The only gate. Read the state, never change it — there is deliberately
      // no ensureReady/wakeIfHibernated call anywhere on this path.
      if (!infra || computeAgentState(infra) !== "running") {
        return { kind: "not-running" };
      }
      try {
        return {
          kind: "state",
          disposition: await deps.runtimeClient.readPullRequest(
            agentId,
            coords,
          ),
        };
      } catch (e) {
        deps.log(
          `pod read failed for ${coords.owner}/${coords.repo}#${coords.number}: ${(e as Error).message}`,
        );
        return { kind: "failed" };
      }
    },
  };
}
