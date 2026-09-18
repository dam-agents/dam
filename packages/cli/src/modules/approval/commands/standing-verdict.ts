import { acceptsPermanentVerdict } from "api-server-api";

import type { ApprovalService } from "../services/approval-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says whether a standing verdict reaches this
 * approval. Some types take only the once verdicts — a satellite job is one, and
 * the service answers not-actionable to a permanent verdict on it. Without this
 * the bare verb would report "not found or already settled" for a row the list
 * shows as pending, and only the --once flag would work. The row is read by its
 * id rather than looked for in a list, which the server clamps: an approval
 * outside the newest page would otherwise read as one that takes only the once
 * verdict. A read that fails answers neither, because quietly downgrading the
 * verdict on a row the CLI never saw would tell the user something about it that
 * nobody checked.
 */
export async function takesStandingVerdict(
  service: ApprovalService,
  id: string,
): Promise<{ ok: true; standing: boolean } | { ok: false; reason: string }> {
  const read = await service.get(id);
  if (!read.ok)
    return {
      ok: false,
      reason: "cannot tell which verdicts this approval takes",
    };
  if (read.value === null)
    return { ok: false, reason: "no such approval, or it is already settled" };
  return { ok: true, standing: acceptsPermanentVerdict(read.value.type) };
}
