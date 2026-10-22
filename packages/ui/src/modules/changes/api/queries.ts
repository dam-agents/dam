import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CompareTo } from "agent-runtime-api";

import { useIsAgentOperable } from "../../agents/api/queries.js";
import { changesClientFor } from "./client.js";
import { changesKeys } from "./keys.js";

export function useChangeSets(
  agentId: string | null,
  sessionId: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: changesKeys.list(agentId ?? "_none", sessionId),
    queryFn: () =>
      changesClientFor(agentId!).changes.list.query(
        sessionId ? { sessionId } : {},
      ),
    enabled: !!agentId && operable,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
    retry: 1,
  });
}

export function useChangeSetDiff(
  agentId: string,
  path: string | null,
  compare: CompareTo,
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: changesKeys.diff(agentId, path ?? "_none", compare),
    queryFn: () =>
      changesClientFor(agentId).changes.diff.query({ path: path!, compare }),
    enabled: operable && path !== null,
    placeholderData: (previous, query) =>
      query?.queryKey[3] === path ? previous : undefined,
    staleTime: 2_000,
    retry: 1,
  });
}
