import { RESULT_ACCEPTED_FIELD, toolOutputTexts } from "agent-runtime-api";

const MARKER = new RegExp(`\\\\?"${RESULT_ACCEPTED_FIELD}\\\\?"\\s*:\\s*true`);

/**
 * UNIT_BOUNDARY_DESCRIPTION: The session whose finished tool call is an
 * accepted report_result, read from the marker field the api-server puts in
 * that tool's answer. report_result runs on the api-server, so this answer is
 * the only sign the target's runtime gets that its run has a result.
 */
export function resultAcceptedIn(frame: unknown): string | null {
  const params = (frame as { params?: unknown } | null)?.params;
  const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  const update = (
    params as { update?: { sessionUpdate?: unknown; status?: unknown } } | null
  )?.update;
  if (update?.sessionUpdate !== "tool_call_update") return null;
  if (update.status !== "completed") return null;
  return toolOutputTexts(update).some((text) => MARKER.test(text))
    ? sessionId
    : null;
}
