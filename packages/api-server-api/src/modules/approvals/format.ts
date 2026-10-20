import { formatSpendAmount } from "../spend/format.js";
import type { ApprovalPayload } from "./types.js";

export function describeApprovalPayload(payload: ApprovalPayload): {
  title: string;
  subtitle: string;
} {
  if (payload.kind === "ext_authz") {
    return {
      title: `${payload.method} ${payload.host}${payload.port ? `:${payload.port}` : ""}`,
      subtitle: payload.viaAgentId
        ? `${payload.path} · via ${payload.viaAgentId}`
        : payload.path,
    };
  }
  if (payload.kind === "spend_limit") {
    const effective = payload.amountMicros * (payload.extensions + 1);
    return {
      title: "Spend limit reached",
      subtitle: `${formatSpendAmount(effective, payload.unit)} on ${payload.day}`,
    };
  }
  return { title: payload.toolName ?? "tool call", subtitle: "" };
}

export function acpNativeRowId(
  agentId: string,
  sessionId: string,
  rpcId: number | string,
): string {
  return `acpnative:${agentId}:${sessionId}:${rpcId}`;
}

export const TOOL_NAME_MAX = 4096;
export const TOOL_CALL_ID_MAX = 512;
export const PERMISSION_OPTIONS_MAX = 16;

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a permission request's tool call becomes in
 * a recorded row. The chat relay and the agent-runtime both write that row, so
 * they must agree: one mapping, applied on both sides, is what lets the second
 * writer join the first instead of shadowing it, and it keeps every field
 * inside the bounds the recording route accepts.
 */
export function recordedToolOf(
  toolCall: { title?: unknown; toolCallId?: unknown } | undefined,
): { toolName: string; toolCallId?: string } {
  const title = typeof toolCall?.title === "string" ? toolCall.title : "";
  const toolCallId =
    typeof toolCall?.toolCallId === "string" && toolCall.toolCallId !== ""
      ? toolCall.toolCallId.slice(0, TOOL_CALL_ID_MAX)
      : undefined;
  return {
    toolName: (title === "" ? "tool call" : title).slice(0, TOOL_NAME_MAX),
    ...(toolCallId !== undefined && { toolCallId }),
  };
}
