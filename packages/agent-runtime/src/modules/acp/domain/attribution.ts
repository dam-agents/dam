import type { Sender } from "agent-runtime-api";
import type { JsonRpcResponse, PlatformVerdict } from "api-server-api";

import {
  isNonNullObject,
  permissionOptionKindsOf,
  platformVerdictKindSchema,
} from "api-server-api";

function permissionRequestParamsOf(
  line: string,
): Record<string, unknown> | null {
  try {
    const frame: unknown = JSON.parse(line);
    if (
      !isNonNullObject(frame) ||
      frame.method !== "session/request_permission"
    )
      return null;
    return isNonNullObject(frame.params) ? frame.params : null;
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a person's answer to a tool call approval
 * decided, keyed by the harness's own tool call id so it still finds its tool
 * call after the log is rebuilt from the harness's history. Null for an answer
 * that picked no option, such as a cancel, and for a request that is not a
 * tool call approval.
 */
export function verdictOf(
  requestLine: string,
  result: unknown,
  by: Sender,
): PlatformVerdict | null {
  const params = permissionRequestParamsOf(requestLine);
  if (params === null) return null;
  const toolCall = params.toolCall;
  const toolCallId = isNonNullObject(toolCall) ? toolCall.toolCallId : null;
  if (typeof toolCallId !== "string" || toolCallId === "") return null;
  const outcome = isNonNullObject(result) ? result.outcome : null;
  if (!isNonNullObject(outcome) || outcome.outcome !== "selected") return null;
  if (typeof outcome.optionId !== "string") return null;
  const kind = platformVerdictKindSchema.safeParse(
    permissionOptionKindsOf(params.options).get(outcome.optionId),
  );
  return kind.success ? { toolCallId, kind: kind.data, by } : null;
}

export function withoutAnsweredBy(frame: JsonRpcResponse): JsonRpcResponse {
  const result = frame.result;
  if (!isNonNullObject(result) || !isNonNullObject(result._meta)) return frame;
  if (!("platform" in result._meta)) return frame;
  const { platform: _stamp, ...meta } = result._meta;
  const { _meta: _stamped, ...rest } = result;
  return {
    ...frame,
    result: Object.keys(meta).length > 0 ? { ...rest, _meta: meta } : rest,
  };
}
