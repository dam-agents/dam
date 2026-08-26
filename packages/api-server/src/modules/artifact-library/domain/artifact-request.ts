import type {
  ArtifactRequestFailureReason,
  ArtifactRequestState,
} from "api-server-api";

import { err, ok, type Result } from "../../../core/result.js";

export const ARTIFACT_REQUEST_HOURLY_CAP = 60;

export const ARTIFACT_REQUEST_WINDOW_MS = 3_600_000;

export const ARTIFACT_REQUEST_IN_FLIGHT_STATES: readonly ArtifactRequestState[] =
  ["pending", "delivered"];

export function isInFlight(state: ArtifactRequestState): boolean {
  return ARTIFACT_REQUEST_IN_FLIGHT_STATES.includes(state);
}

export function windowStart(now: Date): Date {
  return new Date(now.getTime() - ARTIFACT_REQUEST_WINDOW_MS);
}

export interface RequestablePage {
  interactive: boolean;
  visibility: string;
  agentId: string | null;
}

export interface RequestLoad {
  inFlight: boolean;
  requestsInWindow: number;
}

export type RequestRefusal =
  | { code: "not-interactive" }
  | { code: "shared" }
  | { code: "named"; reason: ArtifactRequestFailureReason };

export function admitRequest(
  page: RequestablePage,
  load: RequestLoad,
): Result<{ agentId: string }, RequestRefusal> {
  if (!page.interactive) return err({ code: "not-interactive" });
  if (page.visibility !== "private") return err({ code: "shared" });
  if (page.agentId === null)
    return err({ code: "named", reason: "agent_deleted" });
  if (load.inFlight) return err({ code: "named", reason: "busy" });
  if (load.requestsInWindow >= ARTIFACT_REQUEST_HOURLY_CAP)
    return err({ code: "named", reason: "rate_limited" });
  return ok({ agentId: page.agentId });
}
