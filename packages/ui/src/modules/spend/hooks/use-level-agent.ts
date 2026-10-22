import { useAgentsList } from "../../agents/api/queries.js";
import type { LevelAgent } from "../components/level-icon.js";

export function useLevelAgent(agentId: string): LevelAgent | null {
  const agent = useAgentsList().find((a) => a.id === agentId);
  return agent ? { name: agent.name, avatar: agent.avatar } : null;
}
