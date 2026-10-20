import { formatSpendAmount } from "../spend/format.js";
import type {
  AcpPermissionOption,
  AcpPermissionOptionKind,
  ApprovalPayload,
} from "./types.js";

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
export const RPC_ID_MAX = 4096;

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

const OPTION_KINDS = [
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
] as const;

function optionsWithGivenIds(raw: unknown): AcpPermissionOption[] {
  return (Array.isArray(raw) ? raw : []).flatMap((option) => {
    if (typeof option !== "object" || option === null) return [];
    const { optionId, kind } = option as Record<string, unknown>;
    if (typeof optionId !== "string" || optionId === "") return [];
    const kept = OPTION_KINDS.find((candidate) => candidate === kind);
    return [{ optionId, ...(kept !== undefined && { kind: kept }) }];
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The kind of every option a permission request
 * offered, under the id the harness gave it. The runtime holds the whole
 * request, so this is how an answer's kind is known even for an option the
 * recorded catalog could not keep.
 */
export function permissionOptionKindsOf(
  raw: unknown,
): Map<string, AcpPermissionOptionKind> {
  return new Map(
    optionsWithGivenIds(raw).flatMap(({ optionId, kind }) =>
      kind === undefined ? [] : [[optionId, kind] as const],
    ),
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a permission request's options become in a
 * recorded row. An option the route cannot hold is left out, never shortened:
 * a shortened id is another option's id, and a denial that sent it would
 * answer the request with an allow.
 */
function permissionOptionsOf(raw: unknown): AcpPermissionOption[] {
  return optionsWithGivenIds(raw).filter(
    ({ optionId }) => optionId.length <= TOOL_CALL_ID_MAX,
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The same options inside the recording route's
 * count bound, which keeps one option of each kind first: a catalog that lost
 * every reject option cannot express a denial, and a denial that finds none
 * left must never answer the request with an allow.
 */
export function recordedOptionsOf(raw: unknown): AcpPermissionOption[] {
  const all = permissionOptionsOf(raw);
  if (all.length <= PERMISSION_OPTIONS_MAX) return all;
  const firstOfEachKind = OPTION_KINDS.flatMap(
    (kind) => all.find((option) => option.kind === kind) ?? [],
  );
  return [...firstOfEachKind, ...all]
    .filter((option, index, list) => list.indexOf(option) === index)
    .slice(0, PERMISSION_OPTIONS_MAX)
    .sort((left, right) => all.indexOf(left) - all.indexOf(right));
}
