import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useDeleteAgent, useSetAgentDisabled } from "../api/mutations.js";
import { useConfirmDeleteAgent } from "./use-confirm-delete-agent.js";
import { useRestartAgent } from "./use-restart-agent.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Agent-level acts an Agent's row menu and its
 * menu in the rail both offer: the way into its configuration page, disable or
 * enable, restart, and remove, each asking first where the act cannot be undone
 * or interrupts work.
 */
export function useAgentMenuActions({
  agent,
  current,
  onNavigate,
}: {
  agent: AgentView;
  current: boolean;
  onNavigate: (() => void) | undefined;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const showConfirm = useStore((s) => s.showConfirm);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const setDisabled = useSetAgentDisabled();
  const { restart } = useRestartAgent();
  return {
    updateAvailable: !!agent.templateUpdate,
    onConfigure: () => {
      navigateToSandboxHome(agent.id);
      onNavigate?.();
    },
    onToggleDisabled: () => {
      const disable = async () => {
        if (
          !agent.disabled &&
          !(await showConfirm(
            "The agent stops now, and Slack, Telegram, schedules and SSH won't wake it until you enable it again.",
            "Disable agent?",
            { confirmLabel: "Disable" },
          ))
        )
          return;
        setDisabled.mutate({ id: agent.id, disabled: !agent.disabled });
      };
      void disable();
      onNavigate?.();
    },
    onRestart: () => {
      const ask = async () => {
        if (
          await showConfirm(
            "In-flight work is interrupted and the agent starts fresh.",
            "Restart agent?",
            { confirmLabel: "Restart" },
          )
        )
          restart(agent.id);
      };
      void ask();
      onNavigate?.();
    },
    onRemove: () =>
      void confirmDelete(agent).then((ok) => {
        if (!ok) return;
        deleteAgent.mutate({ id: agent.id });
        if (current) setView("home");
      }),
  };
}
