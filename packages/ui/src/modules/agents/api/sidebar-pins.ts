import { useMutation, useQuery } from "@tanstack/react-query";
import type { SidebarPins } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

const NO_PINS: SidebarPins = { agents: [], sessions: {} };
const pinsKey = () => trpc.sidebarPins.get.queryKey();
const SCOPE = { id: "sidebar-pins" };

export function useSidebarPins(): SidebarPins {
  return (
    useQuery({
      ...trpc.sidebarPins.get.queryOptions(),
      staleTime: 5 * 60_000,
      meta: { errorToast: "Couldn't load your pinned agents and sessions" },
    }).data ?? NO_PINS
  );
}

function patchPins(patch: (pins: SidebarPins) => SidebarPins) {
  queryClient.setQueryData(pinsKey(), (pins) => patch(pins ?? NO_PINS));
}

function refetchPins() {
  void queryClient.invalidateQueries({ queryKey: pinsKey() });
}

export function useSetPinnedAgents() {
  return useMutation(
    trpc.sidebarPins.setAgents.mutationOptions({
      scope: SCOPE,
      onMutate: ({ agentIds }) =>
        patchPins((pins) => ({ ...pins, agents: agentIds })),
      onError: refetchPins,
      meta: { errorToast: "Couldn't save your pinned agents" },
    }),
  );
}

export function useSetPinnedSessions() {
  return useMutation(
    trpc.sidebarPins.setSessions.mutationOptions({
      scope: SCOPE,
      onMutate: ({ agentId, sessionIds }) =>
        patchPins((pins) => ({
          ...pins,
          sessions: { ...pins.sessions, [agentId]: sessionIds },
        })),
      onError: refetchPins,
      meta: { errorToast: "Couldn't save your pinned sessions" },
    }),
  );
}
