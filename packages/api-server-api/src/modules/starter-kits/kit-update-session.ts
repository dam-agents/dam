import { SessionType } from "../sessions/types.js";
import type { KitUpdatePending } from "./types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session a pending Kit Update opened: an
 * initialization chat created at or after the update started. The badge that
 * marks it for the user and the platform's reminder both need this answer, so
 * one predicate decides it and the two cannot disagree.
 */
export function isKitUpdateSession(
  session: {
    initialization?: boolean | null;
    type: string;
    createdAt: string;
  },
  pending: KitUpdatePending | null,
): boolean {
  return (
    pending !== null &&
    session.initialization === true &&
    session.type === SessionType.Regular &&
    Date.parse(session.createdAt) >= Date.parse(pending.startedAt)
  );
}
