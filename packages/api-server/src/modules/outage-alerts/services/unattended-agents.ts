import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { OutageAlertAffectedBy } from "../domain/alert-rules.js";

export type FireKind = "scheduled" | "channel";

export interface UnattendedCandidate {
  agentId: string;
  schedules: boolean;
  slack: boolean;
  telegram: boolean;
  soleProvider: boolean;
}

export interface EnabledSchedule {
  agentId: string;
  continuesSession: boolean;
  harness: string | undefined;
  model: string | undefined;
}

export interface UnattendedAgentOn {
  agentId: string;
  affectedBy: OutageAlertAffectedBy[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the unattended Agents whose fires run on the
 * given template, with each kind of work that does. A Schedule fires on its
 * own choices or the scheduled default, and a channel turn on the channel
 * default, so one Agent's work can run on different providers. `fireTemplate`
 * is null when the work would not fire (no default model, or no granted
 * provider fits) and undefined when the run names no provider, which then
 * runs on the template only when the Agent holds no other provider. A
 * one-time Schedule that continues its session keeps that session's choices,
 * which are not read here, so it never counts.
 */
export function createUnattendedAgentsOn(deps: {
  candidates: (templateId: string) => Promise<UnattendedCandidate[]>;
  enabledSchedules: (agentIds: readonly string[]) => Promise<EnabledSchedule[]>;
  fireTemplate: (
    agentId: string,
    kind: FireKind,
    choices: { harness: string | undefined; model: string | undefined },
  ) => Promise<string | null | undefined>;
}): (templateId: string) => Promise<UnattendedAgentOn[]> {
  return async (templateId) => {
    const candidates = await deps.candidates(templateId);
    const schedules = await deps.enabledSchedules(
      candidates.filter((c) => c.schedules).map((c) => c.agentId),
    );
    const affected: UnattendedAgentOn[] = [];
    for (const candidate of candidates) {
      const firesOn = async (
        kind: FireKind,
        choices: { harness: string | undefined; model: string | undefined },
      ) => {
        const fired = await deps.fireTemplate(candidate.agentId, kind, choices);
        return fired === undefined
          ? candidate.soleProvider
          : fired === templateId;
      };
      try {
        const affectedBy: OutageAlertAffectedBy[] = [];
        const own = schedules.filter(
          (s) => s.agentId === candidate.agentId && !s.continuesSession,
        );
        for (const schedule of own)
          if (await firesOn("scheduled", schedule)) {
            affectedBy.push("schedule");
            break;
          }
        if (
          (candidate.slack || candidate.telegram) &&
          (await firesOn("channel", { harness: undefined, model: undefined }))
        ) {
          if (candidate.slack) affectedBy.push("slack");
          if (candidate.telegram) affectedBy.push("telegram");
        }
        if (affectedBy.length > 0)
          affected.push({ agentId: candidate.agentId, affectedBy });
      } catch (err) {
        getLogger().warn(
          { agentId: candidate.agentId, templateId, reason: formatError(err) },
          "outage_alerts.fire_unresolved",
        );
      }
    }
    return affected;
  };
}
