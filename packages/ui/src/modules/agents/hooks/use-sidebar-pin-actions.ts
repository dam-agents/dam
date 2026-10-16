import type { SidebarPins } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import {
  useSetPinnedAgents,
  useSetPinnedSessions,
} from "../api/sidebar-pins.js";
import {
  movePin,
  type PinDrop,
  stepPin,
  togglePin,
} from "../lib/sidebar-pins.js";

function currentPins(): SidebarPins | undefined {
  return queryClient.getQueryData(trpc.sidebarPins.get.queryKey());
}

export function useSidebarPinActions() {
  const setAgents = useSetPinnedAgents();
  const setSessions = useSetPinnedSessions();

  const writeAgents = (build: (agents: readonly string[]) => string[]) => {
    const pins = currentPins();
    if (!pins) return;
    const next = build(pins.agents);
    if (next.join("\n") !== pins.agents.join("\n"))
      setAgents.mutate({ agentIds: next });
  };
  const writeSessions = (
    agentId: string,
    build: (pinned: readonly string[]) => string[],
  ) => {
    const pins = currentPins();
    if (!pins) return;
    const pinned = pins.sessions[agentId] ?? [];
    const next = build(pinned);
    if (next.join("\n") !== pinned.join("\n"))
      setSessions.mutate({ agentId, sessionIds: next });
  };

  return {
    toggleAgent: (agentId: string) =>
      writeAgents((agents) => togglePin(agents, agentId)),
    moveAgent: (agentId: string, drop: PinDrop | null) =>
      writeAgents((agents) => movePin(agents, agentId, drop)),
    stepAgent: (agentId: string, step: -1 | 1, shown: ReadonlySet<string>) =>
      writeAgents((agents) => stepPin(agents, agentId, step, shown)),
    toggleSession: (agentId: string, sessionId: string) =>
      writeSessions(agentId, (pinned) => togglePin(pinned, sessionId)),
    moveSession: (agentId: string, sessionId: string, drop: PinDrop | null) =>
      writeSessions(agentId, (pinned) => movePin(pinned, sessionId, drop)),
    stepSession: (
      agentId: string,
      sessionId: string,
      step: -1 | 1,
      shown: ReadonlySet<string>,
    ) =>
      writeSessions(agentId, (pinned) =>
        stepPin(pinned, sessionId, step, shown),
      ),
    unpinSession: (agentId: string, sessionId: string) =>
      writeSessions(agentId, (pinned) =>
        pinned.filter((id) => id !== sessionId),
      ),
  };
}
