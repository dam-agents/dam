import { acceptsPermanentVerdict } from "api-server-api";

import type { ApprovalService } from "../services/approval-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says whether a standing verdict reaches this
 * approval. Some types take only the once verdicts — a satellite job is one, and
 * the service answers not-actionable to a permanent verdict on it. Without this
 * the bare verb would report "not found or already settled" for a row the list
 * shows as pending, and only the --once flag would work.
 */
export async function takesStandingVerdict(
  service: ApprovalService,
  id: string,
): Promise<boolean> {
  const listed = await service.listForOwner();
  if (!listed.ok) return true;
  const row = listed.value.find((approval) => approval.id === id);
  return row !== undefined && acceptsPermanentVerdict(row.type);
}
