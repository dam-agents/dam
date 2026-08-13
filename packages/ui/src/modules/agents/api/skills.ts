import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSkillsState(agentId: string | null) {
  return useQuery({
    ...trpc.skills.state.queryOptions(agentId ? { agentId } : skipToken),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSkillSourceCount(agentId: string | null): number | null {
  const { data } = useQuery({
    ...trpc.skills.sources.list.queryOptions(agentId ? { agentId } : skipToken),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  return data?.length ?? null;
}
