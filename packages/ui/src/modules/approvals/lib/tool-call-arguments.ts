import {
  type ApprovalStatus,
  MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES,
  type McpToolCallPayload,
} from "api-server-api";

import { formatBytes } from "../../../lib/format-size.js";

export type ToolCallArguments =
  | { kind: "none" }
  | { kind: "gone"; why: string }
  | { kind: "cut"; text: string; note: string }
  | { kind: "whole"; value: unknown; json: string };

const goneWhy = (status: ApprovalStatus): string =>
  status === "resolved"
    ? "The arguments are no longer kept because this call was answered."
    : status === "expired"
      ? "The arguments are no longer kept because this call's hold ended."
      : "The arguments are not available.";

// UNIT_BOUNDARY_DESCRIPTION: what a tool-call approval can show of the call's arguments. The api-server keeps them only while the approval waits, and above `MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES` it keeps only the first part of their JSON text as a string, which no longer parses. So the arguments are whole, cut (with a note that says how much is shown of how much), gone after the approval settled (with why), or absent because the call sent none.
export function toolCallArgumentsOf(
  payload: McpToolCallPayload,
  status: ApprovalStatus,
): ToolCallArguments {
  if (payload.argumentsBytes === 0) return { kind: "none" };
  if (payload.arguments === undefined)
    return { kind: "gone", why: goneWhy(status) };
  if (payload.argumentsBytes > MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES)
    return {
      kind: "cut",
      text:
        typeof payload.arguments === "string"
          ? payload.arguments
          : JSON.stringify(payload.arguments),
      note: `The arguments were cut: only the first ${formatBytes(MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES)} of ${formatBytes(payload.argumentsBytes)} are shown.`,
    };
  return {
    kind: "whole",
    value: payload.arguments,
    json: JSON.stringify(payload.arguments, null, 2),
  };
}
