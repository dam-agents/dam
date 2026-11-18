import type { KitUpdatePending, KitUpdateStatus } from "api-server-api";

export type KitUpdateBadge =
  { kind: "offer" } | { kind: "running"; pending: KitUpdatePending };

/**
 * UNIT_BOUNDARY_DESCRIPTION: which state the Kit Update badge on an agent's
 * tile shows: the offer while the platform offers an update, and "Kit
 * updating" once the owner started one, until the agent reports it done. The
 * offer wins when a status carries both.
 */
export function kitUpdateBadge(
  update: Pick<KitUpdateStatus, "state" | "pending"> | undefined,
): KitUpdateBadge | null {
  if (!update) return null;
  if (update.state === "available") return { kind: "offer" };
  if (update.pending) return { kind: "running", pending: update.pending };
  return null;
}
