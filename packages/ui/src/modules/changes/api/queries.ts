import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  ChangeSetDiff,
  ChangeSetList,
  CompareTo,
} from "agent-runtime-api";

import { queryClient } from "../../../query-client.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { changesClientFor } from "./client.js";
import { changesKeys } from "./keys.js";

export function seedMockChanges(
  lists: Record<string, ChangeSetList>,
  diffs: Record<string, ChangeSetDiff>,
): void {
  for (const [compositeKey, list] of Object.entries(lists)) {
    const [agentId, sessionId] = compositeKey.split(":");
    if (agentId && sessionId) {
      queryClient.setQueryData(changesKeys.list(agentId, sessionId), list);
    }
  }
  for (const [compositeKey, diff] of Object.entries(diffs)) {
    const parts = compositeKey.split(":");
    const agentId = parts[0];
    const compare = parts[parts.length - 1] as CompareTo;
    const path = parts.slice(1, -1).join(":");
    if (agentId && path) {
      queryClient.setQueryData(changesKeys.diff(agentId, path, compare), diff);
    }
  }
}

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
