import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useDeleteAgent, useLeaveAgent } from "../../agents/api/mutations.js";
import { useConfirmDeleteAgent } from "../../agents/hooks/use-confirm-delete-agent.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the management tasks of an Agent, each behind
 * the confirmation it has wherever it is offered: restart, delete, and leave
 * for an Agent Editor. The agent's General and People sections and
 * the command palette run the same tasks.
 */
export function useAgentManagement() {
  const setView = useStore((s) => s.setView);
  const showConfirm = useStore((s) => s.showConfirm);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const leaveAgent = useLeaveAgent();
  const { restart } = useRestartAgent();

  return {
    deleting: deleteAgent.isPending,
    leaving: leaveAgent.isPending,
    restart: async (agent: AgentView) => {
      if (
        await showConfirm(
          "In-flight work is interrupted and the agent starts fresh.",
          "Restart agent?",
          { confirmLabel: "Restart" },
        )
      )
        restart(agent.id);
    },
    remove: async (agent: AgentView) => {
      if (!(await confirmDelete(agent))) return;
      deleteAgent.mutate(
        { id: agent.id },
        {
          onSuccess: () =>
            emitToast({
              kind: "success",
              message: `Agent “${agent.name}” deleted`,
            }),
        },
      );
      setView("home");
    },
    leave: async (agent: AgentView) => {
      if (
        await showConfirm(
          "You will no longer see this agent. Only its owner can add you back.",
          `Leave “${agent.name}”?`,
          { kind: "destructive", confirmLabel: "Leave" },
        )
      )
        leaveAgent.mutate({ id: agent.id });
    },
  };
}
