import type { SidebarOrder } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import {
  useSetAgentOrder,
  useSetSessionOrder,
  useSidebarOrder,
} from "../api/sidebar-order.js";
import {
  orderAfterMove,
  orderAfterStep,
  type OrderDrop,
} from "../lib/sidebar-order.js";

function loadedOrder(): SidebarOrder | undefined {
  return queryClient.getQueryData(trpc.sidebarOrder.get.queryKey());
}

export function useSidebarOrderActions() {
  const { loaded } = useSidebarOrder();
  const setAgents = useSetAgentOrder();
  const setSessions = useSetSessionOrder();

  const editAgents = (edit: (order: readonly string[]) => string[] | null) => {
    const order = loadedOrder();
    if (!order) return;
    const next = edit(order.agents);
    if (next && next.join("\n") !== order.agents.join("\n"))
      setAgents.mutate({ agentIds: next });
  };
  const editSessions = (
    agentId: string,
    edit: (order: readonly string[]) => string[] | null,
  ) => {
    const order = loadedOrder();
    if (!order) return;
    const current = order.sessions[agentId] ?? [];
    const next = edit(current);
    if (next && next.join("\n") !== current.join("\n"))
      setSessions.mutate({ agentId, sessionIds: next });
  };

  return {
    ready: loaded,
    moveAgent: (shown: readonly string[], agentId: string, drop: OrderDrop) =>
      editAgents((order) => orderAfterMove(order, shown, agentId, drop)),
    stepAgent: (shown: readonly string[], agentId: string, step: -1 | 1) =>
      editAgents((order) => orderAfterStep(order, shown, agentId, step)),
    moveSession: (
      agentId: string,
      shown: readonly string[],
      sessionId: string,
      drop: OrderDrop,
    ) =>
      editSessions(agentId, (order) =>
        orderAfterMove(order, shown, sessionId, drop),
      ),
    stepSession: (
      agentId: string,
      shown: readonly string[],
      sessionId: string,
      step: -1 | 1,
    ) =>
      editSessions(agentId, (order) =>
        orderAfterStep(order, shown, sessionId, step),
      ),
    forgetSession: (agentId: string, sessionId: string) =>
      editSessions(agentId, (order) => order.filter((id) => id !== sessionId)),
  };
}
