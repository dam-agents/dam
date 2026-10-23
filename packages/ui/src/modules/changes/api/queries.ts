import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  ChangeSetDiff,
  ChangeSetList,
  CompareTo,
} from "agent-runtime-api";

import { useIsAgentOperable } from "../../agents/api/queries.js";
import { changesKeys } from "./keys.js";

const isMock = import.meta.env.VITE_MOCK === "true";

let mockChangesData: {
  lists: Record<string, ChangeSetList>;
  diffs: Record<string, ChangeSetDiff>;
} | null = null;

export function seedMockChanges(
  lists: Record<string, ChangeSetList>,
  diffs: Record<string, ChangeSetDiff>,
) {
  mockChangesData = { lists, diffs };
}

export function useChangeSets(
  agentId: string | null,
  sessionId: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery<ChangeSetList>({
    queryKey: changesKeys.list(agentId ?? "_none", sessionId),
    queryFn: () => {
      if (isMock && mockChangesData) {
        const key = `${agentId}:${sessionId}`;
        const data = mockChangesData.lists[key];
        if (data) return data;
      }
      throw new Error("changes tRPC not available on this branch");
    },
    enabled: !!agentId && operable,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
}

export function useChangeSetDiff(
  agentId: string,
  path: string | null,
  compare: CompareTo,
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery<ChangeSetDiff>({
    queryKey: changesKeys.diff(agentId, path ?? "_none", compare),
    queryFn: () => {
      if (isMock && mockChangesData) {
        const key = `${agentId}:${path}:${compare}`;
        const data = mockChangesData.diffs[key];
        if (data) return data;
      }
      throw new Error("changes tRPC not available on this branch");
    },
    enabled: operable && path !== null,
    staleTime: Infinity,
    retry: false,
  });
}
