import { isNonNullObject, parseFrame, sessionUpdateOf } from "api-server-api";

export function cutToolCallFrame(sessionId: string, toolCallId: string) {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        _meta: { platform: { cutBySteer: true } },
      },
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a tool call that an interrupt steer cut fails in
 * the harness's own history, so a log rebuilt from that history would show it
 * as failed. The runtime keeps the ids of the calls it cut and gives every
 * frame that reports such a call failed, a replay of that history included,
 * the same cut mark as its own frame had, so a client shows the call as
 * stopped.
 */
export function withCutMark(line: string, cut: readonly string[]): string {
  if (cut.length === 0) return line;
  const frame = parseFrame(line);
  const update = sessionUpdateOf(frame);
  if (
    update === null ||
    update.status !== "failed" ||
    typeof update.toolCallId !== "string" ||
    !cut.includes(update.toolCallId)
  )
    return line;
  const meta = isNonNullObject(update._meta) ? update._meta : {};
  const platform = isNonNullObject(meta.platform) ? meta.platform : {};
  update._meta = { ...meta, platform: { ...platform, cutBySteer: true } };
  return JSON.stringify(frame);
}
