import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { SchedulesBoot } from "../../schedules/compose.js";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";

type LegacyDisabledAgents = Pick<
  AgentsRepository,
  "list" | "clearLegacyDisabled"
>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the disabled mark outlived the feature that wrote
 * it, so an Agent still carrying one read as asleep but woke on nothing.
 * At boot each Agent still marked has its enabled recurring schedules paused
 * before the mark and its standing stop request are cleared, because a fire that
 * was held while the Agent was disabled would otherwise start running on its own
 * the moment the mark went; the owner resumes them by hand.
 * A one-time task is left alone: it cannot be paused, and its window decides
 * whether it still runs.
 * A failure at either write leaves the Agent marked for the next boot rather
 * than stopping the api-server.
 * The mark is read off the Agent, so the one walk covers both stores.
 */
export async function clearLegacyDisabledMarks(
  agents: LegacyDisabledAgents,
  pauseSchedules: (agentId: string, owner: string) => Promise<number>,
): Promise<number> {
  const marked = (await agents.list()).filter((agent) => agent.disabled);
  let cleared = 0;
  let paused = 0;
  for (const agent of marked) {
    const owner = agent.owner;
    if (owner === undefined) {
      getLogger().warn(
        { agentId: agent.id },
        "agent.legacy_disabled.no_owner — left marked",
      );
      continue;
    }
    try {
      paused += await pauseSchedules(agent.id, owner);
      if (await agents.clearLegacyDisabled(agent.id)) cleared += 1;
    } catch (err) {
      getLogger().warn(
        { agentId: agent.id, reason: formatError(err) },
        "agent.legacy_disabled.cleanup_failed — left marked",
      );
    }
  }
  if (cleared > 0)
    getLogger().info(
      { cleared, paused },
      "agent.legacy_disabled.cleared — these Agents read as idle and wake on next use",
    );
  return cleared;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pause a formerly disabled Agent's schedules get
 * at boot, as the same two writes a pause by hand makes — the spec says disabled
 * and the queued fire is dropped — with the owner's own schedule list as the
 * only input.
 * A one-time task cannot be paused, so its window decides whether it still runs.
 */
export async function pauseEnabledRecurringSchedules(
  schedules: Pick<SchedulesBoot, "repo" | "runner">,
  agentId: string,
  owner: string,
): Promise<number> {
  let paused = 0;
  for (const sched of await schedules.repo.list(agentId, owner)) {
    if (sched.spec.type === "once" || !sched.spec.enabled) continue;
    const next = await schedules.repo.updateSpec(sched.id, owner, {
      ...sched.spec,
      enabled: false,
    });
    if (!next) continue;
    await schedules.runner.cancel(sched.id);
    paused += 1;
  }
  return paused;
}
