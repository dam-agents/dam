import { Power, Restart, TrashCan } from "@carbon/icons-react";

import type { AgentView } from "../../../types.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { type Action, ActionList } from "./action-list.js";

export function AgentManagementActions({
  agent,
  display,
}: {
  agent: AgentView;
  display: AgentDisplay;
}) {
  const actions: Action[] = [
    {
      icon: <Power />,
      kind: "button",
      title: agent.state === "running" ? "Disable agent" : "Enable agent",
      description:
        agent.state === "running"
          ? "Stop the agent and keep it asleep."
          : "The agent is disabled. Enable it to let messages, schedules and connections wake it again.",
      button: {
        label: agent.state === "running" ? "Disable" : "Enable",
        onClick: () => {},
        testId: "agent-toggle-disabled",
      },
    },
    {
      icon: <Restart />,
      kind: "button",
      title: "Restart agent",
      description:
        display.powerAction === "restart"
          ? "Interrupt in-flight work and start the agent fresh."
          : "The agent is not running. It starts fresh when it wakes.",
      button: {
        label: "Restart",
        disabled: display.powerAction !== "restart",
        onClick: () => {},
      },
    },
    {
      icon: <TrashCan />,
      kind: "button",
      title: "Delete agent",
      description:
        "Delete the agent with its workspace and sessions. There is no going back.",
      button: {
        label: "Delete",
        onClick: () => {},
        danger: true,
      },
    },
  ];

  return <ActionList label="Manage" actions={actions} />;
}
