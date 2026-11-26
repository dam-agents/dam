import { useAgent } from "../../agents/api/queries.js";
import type { LevelAgent } from "../components/level-icon.js";

export function useLevelAgent(agentId: string | null): LevelAgent | null {
  const agent = useAgent(agentId);
  return agent ? { name: agent.name, avatar: agent.avatar } : null;
}
