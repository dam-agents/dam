import type { SidebarPins } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import {
  useSetPinnedAgents,
  useSetPinnedSessions,
  useSidebarPins,
} from "../api/sidebar-pins.js";
import {
  movePin,
  type PinDrop,
  stepPin,
  togglePin,
} from "../lib/sidebar-pins.js";

function loadedPins(): SidebarPins | undefined {
  return queryClient.getQueryData(trpc.sidebarPins.get.queryKey());
}

export function useSidebarPinActions() {
  const { loaded } = useSidebarPins();
  const setAgents = useSetPinnedAgents();
  const setSessions = useSetPinnedSessions();

  const editAgents = (edit: (pinned: readonly string[]) => string[]) => {
    const pins = loadedPins();
    if (!pins) return;
    const next = edit(pins.agents);
    if (next.join("\n") !== pins.agents.join("\n"))
      setAgents.mutate({ agentIds: next });
  };
  const editSessions = (
    agentId: string,
    edit: (pinned: readonly string[]) => string[],
  ) => {
    const pins = loadedPins();
    if (!pins) return;
    const pinned = pins.sessions[agentId] ?? [];
    const next = edit(pinned);
    if (next.join("\n") !== pinned.join("\n"))
      setSessions.mutate({ agentId, sessionIds: next });
  };

  return {
    ready: loaded,
    toggleAgent: (agentId: string) =>
      editAgents((pinned) => togglePin(pinned, agentId)),
    moveAgent: (agentId: string, drop: PinDrop) =>
      editAgents((pinned) => movePin(pinned, agentId, drop)),
    stepAgent: (agentId: string, step: -1 | 1, shown: ReadonlySet<string>) =>
      editAgents((pinned) => stepPin(pinned, agentId, step, shown)),
    toggleSession: (agentId: string, sessionId: string) =>
      editSessions(agentId, (pinned) => togglePin(pinned, sessionId)),
    moveSession: (agentId: string, sessionId: string, drop: PinDrop) =>
      editSessions(agentId, (pinned) => movePin(pinned, sessionId, drop)),
    stepSession: (
      agentId: string,
      sessionId: string,
      step: -1 | 1,
      shown: ReadonlySet<string>,
    ) =>
      editSessions(agentId, (pinned) =>
        stepPin(pinned, sessionId, step, shown),
      ),
    unpinSession: (agentId: string, sessionId: string) =>
      editSessions(agentId, (pinned) =>
        pinned.filter((id) => id !== sessionId),
      ),
  };
}
