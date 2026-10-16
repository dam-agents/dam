import { useMutation, useQuery } from "@tanstack/react-query";
import type { SidebarOrder } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

const NO_ORDER: SidebarOrder = { agents: [], sessions: {} };
const orderKey = () => trpc.sidebarOrder.get.queryKey();
const SCOPE = { id: "sidebar-order" };

export function useSidebarOrder(): { order: SidebarOrder; loaded: boolean } {
  const { data } = useQuery({
    ...trpc.sidebarOrder.get.queryOptions(),
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't load your sidebar order" },
  });
  return { order: data ?? NO_ORDER, loaded: data !== undefined };
}

async function patchOrder(patch: (order: SidebarOrder) => SidebarOrder) {
  await queryClient.cancelQueries({ queryKey: orderKey() });
  queryClient.setQueryData(orderKey(), (order) => patch(order ?? NO_ORDER));
}

function refetchOrder() {
  void queryClient.invalidateQueries({ queryKey: orderKey() });
}

export function useSetAgentOrder() {
  return useMutation(
    trpc.sidebarOrder.setAgents.mutationOptions({
      scope: SCOPE,
      onMutate: ({ agentIds }) =>
        patchOrder((order) => ({ ...order, agents: agentIds })),
      onError: refetchOrder,
      meta: { errorToast: "Couldn't save the order of your agents" },
    }),
  );
}

export function useSetSessionOrder() {
  return useMutation(
    trpc.sidebarOrder.setSessions.mutationOptions({
      scope: SCOPE,
      onMutate: ({ agentId, sessionIds }) =>
        patchOrder((order) => ({
          ...order,
          sessions: { ...order.sessions, [agentId]: sessionIds },
        })),
      onError: refetchOrder,
      meta: { errorToast: "Couldn't save the order of your sessions" },
    }),
  );
}
