import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const SKILLS_STALE_MS = 30_000;
const SKILLS_GC_MS = 24 * 60 * 60_000;

export function useSkillsState(
  agentId: string | null,
  opts: { pollMs?: number } = {},
) {
  return useQuery({
    ...trpc.skills.state.queryOptions(agentId ? { agentId } : skipToken),
    retry: false,
    staleTime: SKILLS_STALE_MS,
    gcTime: SKILLS_GC_MS,
    ...(opts.pollMs === undefined ? {} : { refetchInterval: opts.pollMs }),
  });
}

export function useSkillSources(agentId: string | null) {
  return useQuery({
    ...trpc.skills.sources.list.queryOptions(agentId ? { agentId } : skipToken),
    retry: false,
    staleTime: SKILLS_STALE_MS,
    gcTime: SKILLS_GC_MS,
  });
}

export function useSkillSourceCount(agentId: string | null): number | null {
  const { data } = useSkillSources(agentId);
  return data ? data.filter((s) => !s.hidden).length : null;
}
