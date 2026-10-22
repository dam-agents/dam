import { useFeatures } from "../../features/api/queries.js";

export function useChatFormsEnabled(): boolean {
  return useFeatures().data?.["chat-forms"] ?? false;
}
