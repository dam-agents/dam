import { useCallback } from "react";

import { useDeleteAgent } from "../modules/agents/api/mutations.js";
import { useRestartAgent } from "../modules/agents/hooks/use-restart-agent.js";
import { useSuspendAgent } from "../modules/agents/hooks/use-suspend-agent.js";
import { useWakeAgent } from "../modules/agents/hooks/use-wake-agent.js";
import { isKnowledgeBase } from "../modules/agents/utils/agent-kind.js";
import { fetchSchedulesForAgent } from "../modules/schedules/api/queries.js";
import { useStore } from "../store.js";
import type { AgentView } from "../types.js";

export function useSidebarAgentActions() {
  const selectAgent = useStore((s) => s.selectAgent);
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);

  const deleteAgent = useDeleteAgent();
  const suspend = useSuspendAgent();
  const { restart } = useRestartAgent();
  const wakeAgent = useWakeAgent();

  const onSelect = useCallback(
    (agent: AgentView) => {
      if (isKnowledgeBase(agent)) {
        openKnowledgeBase(agent.id);
      } else {
        selectAgent(agent.id);
      }
    },
    [selectAgent, openKnowledgeBase],
  );

  const onConfigure = useCallback(
    (agent: AgentView) => navigateToSandboxHome(agent.id),
    [navigateToSandboxHome],
  );

  const onWake = useCallback(
    (agent: AgentView) => wakeAgent.wake(agent.id),
    [wakeAgent],
  );

  const onRestart = useCallback(
    (agent: AgentView) => restart(agent.id),
    [restart],
  );

  const onPause = useCallback(
    (agent: AgentView) => suspend.pause(agent.id),
    [suspend],
  );

  const onStop = useCallback(
    async (agent: AgentView) => {
      const schedules = await fetchSchedulesForAgent(agent.id);
      const scheduleNote =
        schedules.length > 0 ? (
          <>
            {" "}
            This agent has <strong>{schedules.length} schedule(s)</strong> — the
            next fire will start it again.
          </>
        ) : null;
      const msg = (
        <>
          Stop agent <strong className="text-foreground">"{agent.name}"</strong>
          ? It stays stopped until you start it.{scheduleNote}
        </>
      );
      if (!(await showConfirm(msg, "Stop Agent"))) return;
      suspend.stop(agent.id);
    },
    [showConfirm, suspend],
  );

  const onDelete = useCallback(
    async (agent: AgentView) => {
      const msg = (
        <>
          Delete agent{" "}
          <strong className="text-foreground">"{agent.name}"</strong>? This will
          also delete <strong>all persistent data</strong> and cannot be undone.
        </>
      );
      if (!(await showConfirm(msg, "Delete Agent", { kind: "destructive" })))
        return;
      deleteAgent.mutate({ id: agent.id });
    },
    [showConfirm, deleteAgent],
  );

  const isDeletePending = useCallback(
    (agentId: string) =>
      deleteAgent.isPending && deleteAgent.variables?.id === agentId,
    [deleteAgent],
  );

  return {
    onSelect,
    onConfigure,
    onWake,
    onRestart,
    onPause,
    onStop,
    onDelete,
    isDeletePending,
  };
}
