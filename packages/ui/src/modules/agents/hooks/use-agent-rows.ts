import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useOwnerSchedules } from "../../schedules/api/queries.js";
import { useDeleteAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "./use-restart-agent.js";
import { useSuspendAgent, useSyncPausingAgents } from "./use-suspend-agent.js";
import { useUpdateSandbox } from "./use-update-sandbox.js";
import { useWakeAgent } from "./use-wake-agent.js";

export function useAgentRows() {
  const { data: agentsData } = useAgents();
  const { data: ownerSchedules } = useOwnerSchedules();
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();
  const pausingAgents = useStore((s) => s.pausingAgents);
  useSyncPausingAgents();

  const deleteAgent = useDeleteAgent();
  const suspend = useSuspendAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();
  const update = useUpdateSandbox();

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
  );

  const scheduleCountByAgent = useMemo(() => {
    if (!ownerSchedules) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const s of ownerSchedules) {
      if (s.enabled) {
        counts.set(s.agentId, (counts.get(s.agentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [ownerSchedules]);

  const rowProps = (agent: AgentView) => ({
    agent,
    display: resolveAgentDisplay(agent, restartingIds, pausingIds),
    scheduleCount: scheduleCountByAgent.get(agent.id) ?? 0,
    deletePending:
      deleteAgent.isPending && deleteAgent.variables?.id === agent.id,
    updatePending: update.updatingId === agent.id,
    updateBusy: update.updatingId !== null || update.updatingAll,
    onUpdate: () => void update.updateOne(agent),
    onWake: () => wakeAgent.wake(agent.id),
    onRestart: () => restartAgent(agent.id),
    onPause: () => suspend.pause(agent.id),
    onStop: () => suspend.stop(agent.id),
  });

  return {
    agentsData,
    initialLoaded: agentsData !== undefined,
    rowProps,
    deleteAgent,
    suspend,
    update,
  };
}
