import type {
  ApprovalPayload,
  ApprovalType,
  SatelliteJobPayload,
} from "./types.js";

const MAX_CALL_CHARS = 300;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Renders the call a person is being asked to allow.
 * It is the argv, not the Command Pattern that matched it: a pattern cannot tell
 * staging from production, and the whole point of the hold is that a person
 * decides on what will actually run. Both surfaces read this one function so
 * neither can drift into showing the weaker thing.
 */
export function describeSatelliteCall(payload: SatelliteJobPayload): string {
  const cmd = payload.args.cmd;
  const rendered =
    Array.isArray(cmd) &&
    cmd.length > 0 &&
    cmd.every((a) => typeof a === "string")
      ? (cmd as string[]).join(" ")
      : `${payload.tool} ${JSON.stringify(payload.args)}`;
  return rendered.length > MAX_CALL_CHARS
    ? `${rendered.slice(0, MAX_CALL_CHARS)}…`
    : rendered;
}

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
    return { title: payload.ref, subtitle: describeSatelliteCall(payload) };
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
