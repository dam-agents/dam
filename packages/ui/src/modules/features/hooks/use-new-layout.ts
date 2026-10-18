import { useFeatures } from "../api/queries.js";

export function useNewLayout(): boolean {
  return useFeatures().data?.["new-layout"] ?? false;
}
