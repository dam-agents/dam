import type { ApprovalPayload } from "./types.js";

export function describeApprovalPayload(payload: ApprovalPayload): {
  title: string;
  subtitle: string;
} {
  if (payload.kind === "ext_authz") {
    return {
      title: `${payload.method} ${payload.host}`,
      subtitle: payload.path,
    };
  }
  return { title: payload.toolName ?? "tool call", subtitle: "" };
}
