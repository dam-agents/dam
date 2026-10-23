import type { ApprovalView } from "api-server-api";

export function isHeldCallStillLive(row: ApprovalView): boolean {
  return (
    row.status === "pending" && new Date(row.expiresAt).getTime() > Date.now()
  );
}
