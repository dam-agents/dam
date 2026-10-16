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

function currentPins(): SidebarPins {
  return (
    queryClient.getQueryData(trpc.sidebarPins.get.queryKey()) ?? {
      agents: [],
      sessions: {},
    }
  );
}

export function useSidebarPinActions() {
  const setAgents = useSetPinnedAgents();
  const setSessions = useSetPinnedSessions();

  const writeAgents = (next: string[]) => {
    const { agents } = currentPins();
    if (next.join("\n") !== agents.join("\n"))
      setAgents.mutate({ agentIds: next });
  };
  const writeSessions = (agentId: string, next: string[]) => {
    const pinned = currentPins().sessions[agentId] ?? [];
    if (next.join("\n") !== pinned.join("\n"))
      setSessions.mutate({ agentId, sessionIds: next });
  };

  return {
    toggleAgent: (agentId: string) =>
      writeAgents(togglePin(currentPins().agents, agentId)),
    moveAgent: (agentId: string, drop: PinDrop | null) =>
      writeAgents(movePin(currentPins().agents, agentId, drop)),
    stepAgent: (agentId: string, step: -1 | 1, shown: ReadonlySet<string>) =>
      writeAgents(stepPin(currentPins().agents, agentId, step, shown)),
    stepSession: (
      agentId: string,
      sessionId: string,
      step: -1 | 1,
      shown: ReadonlySet<string>,
    ) =>
      writeSessions(
        agentId,
        stepPin(currentPins().sessions[agentId] ?? [], sessionId, step, shown),
      ),
    toggleSession: (agentId: string, sessionId: string) =>
      writeSessions(
        agentId,
        togglePin(currentPins().sessions[agentId] ?? [], sessionId),
      ),
    moveSession: (agentId: string, sessionId: string, drop: PinDrop | null) =>
      writeSessions(
        agentId,
        movePin(currentPins().sessions[agentId] ?? [], sessionId, drop),
      ),
    unpinSession: (agentId: string, sessionId: string) => {
      const pinned = currentPins().sessions[agentId] ?? [];
      if (pinned.includes(sessionId))
        writeSessions(
          agentId,
          pinned.filter((id) => id !== sessionId),
        );
    },
  };
}
