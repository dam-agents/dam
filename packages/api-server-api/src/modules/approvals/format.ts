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
