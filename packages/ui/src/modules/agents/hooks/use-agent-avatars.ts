import { useFeatures } from "../../features/api/queries.js";

export function useAgentAvatars(): boolean {
  return useFeatures().data?.["agent-avatars"] ?? false;
}
