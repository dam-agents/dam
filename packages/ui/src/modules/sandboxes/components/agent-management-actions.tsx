import { Play, Power, Restart, TrashCan } from "@carbon/icons-react";
import { useEffect } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useDeleteAgent,
  useSetAgentDisabled,
} from "../../agents/api/mutations.js";
import { useConfirmDeleteAgent } from "../../agents/hooks/use-confirm-delete-agent.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { AGENT_ENABLE_ANCHOR } from "../../agents/lib/overlay-copy.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { type Action, ActionList } from "./action-list.js";

export function AgentManagementActions({
  agent,
  display,
}: {
  agent: AgentView;
  display: AgentDisplay;
}) {
  const setView = useStore((s) => s.setView);
  const showConfirm = useStore((s) => s.showConfirm);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const setDisabled = useSetAgentDisabled();
  const wakeAgent = useWakeAgent();
  const { restart } = useRestartAgent();

  useEffect(() => {
    if (location.hash === `#${AGENT_ENABLE_ANCHOR}`)
      document
        .getElementById(AGENT_ENABLE_ANCHOR)
        ?.scrollIntoView({ block: "center" });
  }, []);

  const onToggleDisabled = async () => {
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

  const onDelete = async () => {
    if (!(await confirmDelete(agent))) return;
    deleteAgent.mutate({ id: agent.id });
    setView("home");
  };

  const actions: Action[] = [
    {
      id: AGENT_ENABLE_ANCHOR,
      title: agent.disabled ? "Enable agent" : "Disable agent",
      description: agent.disabled
        ? "The agent is disabled. Enable it to let messages, schedules and connections wake it again."
        : "Stop the agent and keep it asleep: nothing wakes it until you enable it again.",
      button: {
        icon: <Power />,
        label: agent.disabled ? "Enable" : "Disable",
        disabled: setDisabled.isPending,
        onClick: () => void onToggleDisabled(),
        testId: "agent-toggle-disabled",
      },
    },
    display.powerAction === "start"
      ? {
          title: "Wake agent",
          description: "Start the agent now instead of on its next use.",
          button: {
            icon: <Play />,
            label: "Wake",
            onClick: () => wakeAgent.wake(agent.id),
          },
        }
      : {
          title: "Restart agent",
          description: "Interrupt in-flight work and start the agent fresh.",
          button: {
            icon: <Restart />,
            label: "Restart",
            disabled: display.powerAction === null,
            onClick: () => restart(agent.id),
          },
        },
    {
      title: "Delete agent",
      description:
        "Delete the agent with its workspace and sessions. There is no going back.",
      button: {
        icon: <TrashCan />,
        label: "Delete",
        disabled: deleteAgent.isPending,
        onClick: () => void onDelete(),
        danger: true,
      },
    },
  ];

  return <ActionList label="Manage" actions={actions} />;
}
