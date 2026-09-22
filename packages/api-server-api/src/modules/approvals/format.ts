import type { ApprovalPayload, ApprovalType } from "./types.js";

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
    return { title: payload.ref, subtitle: payload.reason };
  return { title: payload.toolName ?? "tool call", subtitle: "" };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says which approval types accept a standing verdict.
 * A satellite job takes only the once verdicts — "allow forever" for a satellite
 * is spelled by removing approval = always from the Manifest, on the user's own
 * machine. The service refuses a permanent verdict on one, so the surfaces must
 * not offer a button the service will refuse.
 */
export function acceptsPermanentVerdict(type: ApprovalType): boolean {
  return type !== "satellite_job";
}
