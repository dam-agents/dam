import type { AssistantNotice } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one-time news Home shows, and only while the
 * person has the assistant: the record's cached row outlives a turn-off — its
 * query is disabled, not emptied — so without the gate Home would keep claiming
 * a name belongs to an assistant that no longer exists.
 */
export function renameNoticeOf(
  state: { notice: AssistantNotice | null } | null | undefined,
  assistantOn: boolean,
): AssistantNotice | null {
  if (!assistantOn) return null;
  return state?.notice ?? null;
}
