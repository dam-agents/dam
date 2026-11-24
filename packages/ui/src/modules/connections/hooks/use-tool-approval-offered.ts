import { useFeatures } from "../../features/api/queries.js";

export function useToolApprovalOffered(): boolean {
  return useFeatures().data?.["mcp-tool-approval"] ?? false;
}
