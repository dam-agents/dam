import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

// Forks hibernate and expire on their own timers, so both lists poll — a
// stale row would show compute (and budget) that is no longer held.
const FORK_POLL_MS = 15_000;

/** Forks running against one agent — the owner's visibility surface. */
export function useAgentForks(agentId: string | null) {
  return useQuery({
    ...trpc.forks.listByAgent.queryOptions(
      agentId === null ? skipToken : { agentId },
    ),
    refetchInterval: FORK_POLL_MS,
    meta: { errorToast: "Couldn't load forks" },
  });
}

/** Forks acting as the caller — their budget itemization. */
export function useMyForks() {
  return useQuery({
    ...trpc.forks.listMine.queryOptions(),
    refetchInterval: FORK_POLL_MS,
    meta: { errorToast: "Couldn't load your forks" },
  });
}
