import type { ProfileWithUsage } from "api-server-api";

import type { Schedule } from "../../../types.js";
import {
  defaultProfileId,
  newestProfileId,
} from "../../profiles/lib/default-profile.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a new schedule starts on (D92): the
 * one the agent's most recently created schedule runs on, else the chat
 * profile, else the seeded Default. Read from the lists the page already holds,
 * so no endpoint exists for it.
 */
export function schedulePresetProfileId({
  schedules,
  profiles,
  chatProfileId,
}: {
  schedules: readonly Schedule[];
  profiles: readonly ProfileWithUsage[];
  chatProfileId: string | null;
}): string | null {
  return defaultProfileId({
    profiles,
    /* UNIT_BOUNDARY_DESCRIPTION: schedules.list answers oldest first, so the
     * newest schedule is the last one. */
    newestProfileId: newestProfileId(
      [...schedules].reverse().map((s) => ({ profileId: s.profile })),
    ),
    chatProfileId,
  });
}
