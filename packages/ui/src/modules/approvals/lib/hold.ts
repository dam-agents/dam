import type { ApprovalView } from "api-server-api";

/** The held call can still be released — pending and the hold not expired.
 *  `status` flips lazily server-side, so a pending row may already be dead. */
export function isHeldCallStillLive(row: ApprovalView): boolean {
  return (
    row.status === "pending" && new Date(row.expiresAt).getTime() > Date.now()
  );
}
