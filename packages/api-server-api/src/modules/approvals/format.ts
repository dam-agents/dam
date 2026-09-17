import type { ApprovalPayload } from "./types.js";

export function describeApprovalPayload(payload: ApprovalPayload): {
  title: string;
  subtitle: string;
} {
  if (payload.kind === "ext_authz") {
    return {
      title: `${payload.method} ${payload.host}`,
      subtitle: payload.viaAgentId
        ? `${payload.path} · via ${payload.viaAgentId}`
        : payload.path,
    };
  }
  if (payload.kind === "satellite_job")
    return { title: payload.ref, subtitle: payload.cmd.join(" ") };
  return { title: payload.toolName ?? "tool call", subtitle: "" };
}
