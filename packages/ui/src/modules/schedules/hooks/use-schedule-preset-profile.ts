import { useProfiles } from "../../profiles/api/queries.js";
import { useSessionDefaults } from "../../sessions/api/session-pair.js";
import { useSchedules } from "../api/queries.js";
import { schedulePresetProfileId } from "../lib/schedule-preset-profile.js";

/** UNIT_BOUNDARY_DESCRIPTION: what a new schedule's Profile field opens on, read from the lists the page already holds. */
export function useSchedulePresetProfile(
  agentId: string,
  enabled: boolean,
): string | null {
  const { data: schedules = [] } = useSchedules(enabled ? agentId : null);
  const { data: profiles = [] } = useProfiles(enabled ? agentId : null);
  const chatProfileId = useSessionDefaults(enabled ? agentId : null).data
    ?.chatProfileId;
  return schedulePresetProfileId({
    schedules,
    profiles,
    chatProfileId: chatProfileId ?? null,
  });
}
