import { Cloud, Power, Restart, TrashCan } from "@carbon/icons-react";
import { useEffect } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useDeleteAgent,
  useSetAgentDisabled,
} from "../../agents/api/mutations.js";
import { useConfirmDeleteAgent } from "../../agents/hooks/use-confirm-delete-agent.js";
import { useRestartAgent } from "../../agents/hooks/use-restart-agent.js";
import { AGENT_ENABLE_ANCHOR } from "../../agents/lib/overlay-copy.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import {
  useEnvironments,
  useEnvironmentsEnabled,
} from "../../environments/api/queries.js";
import { type Action, ActionList } from "./action-list.js";

export function AgentManagementActions({
  agent,
  display,
}: {
  agent: AgentView;
  display: AgentDisplay;
}) {
  const setView = useStore((s) => s.setView);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const setDisabled = useSetAgentDisabled();
  const { restart } = useRestartAgent();
  const environmentsEnabled = useEnvironmentsEnabled();
  const environments = useEnvironments(
    environmentsEnabled && agent.vm ? agent.id : null,
    { poll: false },
  );
  const accessListReach = environments.data?.length === 0;

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

  const onRestart = async () => {
    if (
      await showConfirm(
        "In-flight work is interrupted and the agent starts fresh.",
        "Restart agent?",
        { confirmLabel: "Restart" },
      )
    )
      restart(agent.id);
  };

  const onDelete = async () => {
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
  };

  const actions: Action[] = [
    {
      id: AGENT_ENABLE_ANCHOR,
      kind: "button",
      icon: <Power />,
      title: agent.disabled ? "Enable agent" : "Disable agent",
      description: agent.disabled
        ? "The agent is disabled. Enable it to let messages, schedules and connections wake it again."
        : "Stop the agent and keep it asleep.",
      button: {
        label: agent.disabled ? "Enable" : "Disable",
        disabled: setDisabled.isPending,
        onClick: () => void onToggleDisabled(),
        testId: "agent-toggle-disabled",
      },
    },
    {
      kind: "button",
      icon: <Restart />,
      title: "Restart agent",
      description:
        display.powerAction === "restart"
          ? "Interrupt in-flight work and start the agent fresh."
          : agent.disabled
            ? "The agent is disabled. Enable it to restart it."
            : display.powerAction === "start"
              ? "The agent is not running. It starts fresh when it wakes."
              : "The agent is starting. You can restart it once it runs.",
      button: {
        label: "Restart",
        disabled: display.powerAction !== "restart",
        onClick: () => void onRestart(),
      },
    },
    ...(accessListReach
      ? [
          {
            kind: "link" as const,
            icon: <Cloud />,
            title: "Choose who may open Environments",
            description:
              "This agent has none yet and creates them itself. Name the people who may open the ones it creates.",
            onClick: () => navigateToSandboxHome(agent.id, "environments"),
          },
        ]
      : []),
    {
      kind: "button",
      icon: <TrashCan />,
      title: "Delete agent",
      description:
        "Delete the agent with its workspace and sessions. There is no going back.",
      button: {
        label: "Delete",
        disabled: deleteAgent.isPending,
        onClick: () => void onDelete(),
        danger: true,
      },
    },
  ];

  return <ActionList label="Manage" actions={actions} />;
}
