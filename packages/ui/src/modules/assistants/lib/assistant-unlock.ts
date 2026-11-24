import type { AvatarUnlock, GettingStartedProgress } from "api-server-api";

import { deriveChecklist } from "../../getting-started/lib/derive-checklist.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one celebration the assistant's chat plays — the
 * avatar an Agent the platform made unlocked, which the create records unseen.
 * Every other unlock belongs to the Get started panel, and a seen one plays
 * nowhere, so a second landing is quiet.
 */
export function assistantUnlockToCelebrate(
  progress: GettingStartedProgress | undefined,
): { unlock: AvatarUnlock; variant: "first-agent" } | null {
  const celebrating = progress ? deriveChecklist(progress).celebrating : null;
  if (celebrating === null || celebrating.variant !== "first-agent")
    return null;
  return { unlock: celebrating.unlock, variant: "first-agent" };
}
