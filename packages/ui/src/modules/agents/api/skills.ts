import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/**
 * An agent's skills state (installed / standalone / publishes) for the sidebar
 * summary. Degrades to no data (rather than throwing) while the pod is asleep.
 *
 * Deliberately does NOT poll: `skills.state` self-heals by reconciling tracked
 * rows against the pod's on-disk skills, which transiently drops a just-toggled
 * skill before the pod applies it. A recurring poll would land inside that
 * settle window and revert an in-flight install (#2775), so we fetch once —
 * enough for a summary line.
 */
export function useSkillsState(agentId: string | null) {
  return useQuery({
    ...trpc.skills.state.queryOptions(agentId ? { agentId } : skipToken),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
