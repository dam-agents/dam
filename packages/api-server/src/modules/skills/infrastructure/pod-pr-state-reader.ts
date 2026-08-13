import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import { computeAgentState } from "../../agents/infrastructure/agent-mappers.js";
import type { PodPrStateReader } from "../domain/pr-state.js";
import type { AgentRuntimeSkillsClient } from "./agent-runtime-client.js";

export function createPodPrStateReader(deps: {
  agents: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  log: (msg: string) => void;
}): PodPrStateReader {
  return {
    async read(agentId, coords) {
      const infra = await deps.agents.get(agentId);
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
