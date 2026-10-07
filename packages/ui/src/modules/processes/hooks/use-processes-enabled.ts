import { useFeatures } from "../../features/api/queries.js";

export function useProcessesEnabled(): boolean {
  return useFeatures().data?.processes ?? false;
}
