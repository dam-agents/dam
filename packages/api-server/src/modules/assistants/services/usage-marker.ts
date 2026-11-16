import type { SessionDirectoryEntry } from "agent-runtime-api";

import { emit, EventType } from "../../../events.js";
import type { AssistantsRepository } from "../infrastructure/assistants-repository.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a reported Session is a use of the
 * assistant: it must not be used already, and the Session must have begun after
 * the person's last onboarding reset. A runtime that boots re-reports the
 * Sessions it already had, and a reset means the person is a first-timer again —
 * neither may mark the assistant used, or the greeting and the landing would
 * never come back.
 */
export function countsAsUse(
  usage: { used: boolean; resetAt: Date | null },
  sessionAt: Date,
): boolean {
  if (usage.used) return false;
  return usage.resetAt === null || sessionAt > usage.resetAt;
}

/** UNIT_BOUNDARY_DESCRIPTION: the newest of the Sessions one report carries, which is the only one whose start decides whether the report is a use. */
export function newestSessionAt(
  sessions: readonly SessionDirectoryEntry[],
): Date | null {
  let newest: Date | null = null;
  for (const session of sessions) {
    const at = new Date(session.createdAt);
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The assistant's used mark, decided where every
 * Session report passes. It is what makes the first landing and the greeting
 * disappear, so it is written once and announced — another tab or a channel turn
 * marks the assistant used without that tab having sent anything, and the
 * owner's open tabs learn it here rather than on their next reload.
 */
export function createAssistantUsageMarker(deps: {
  repo: Pick<AssistantsRepository, "usageOf" | "markUsed">;
}): (
  agentId: string,
  sessions: readonly SessionDirectoryEntry[],
) => Promise<void> {
  return async (agentId, sessions) => {
    const sessionAt = newestSessionAt(sessions);
    if (sessionAt === null) return;
    const usage = await deps.repo.usageOf(agentId);
    if (usage === null || !countsAsUse(usage, sessionAt)) return;
    await deps.repo.markUsed(agentId);
    emit({ type: EventType.AssistantUsed, agentId, ownerSub: usage.owner });
  };
}
