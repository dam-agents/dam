import { Cloud, Power, Restart, TrashCan } from "@carbon/icons-react";
import { useEffect } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { holds, ownerName } from "../../agents/lib/agent-permissions.js";
import { AGENT_ENABLE_ANCHOR } from "../../agents/lib/overlay-copy.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import {
  useEnvironments,
  useEnvironmentsEnabled,
} from "../../environments/api/queries.js";
import { useAgentManagement } from "../hooks/use-agent-management.js";
import { type Action, ActionList } from "./action-list.js";

export function AgentManagementActions({
  agent,
  display,
}: {
  agent: AgentView;
  display: AgentDisplay;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const management = useAgentManagement();
  const environmentsEnabled = useEnvironmentsEnabled();
  const environments = useEnvironments(environmentsEnabled ? agent.id : null, {
    poll: false,
  });
  const accessListReach = environments.data?.length === 0;

  useEffect(() => {
    if (location.hash === `#${AGENT_ENABLE_ANCHOR}`)
      document
        .getElementById(AGENT_ENABLE_ANCHOR)
        ?.scrollIntoView({ block: "center" });
  }, []);

  const lifecycle: Action[] = [
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
        disabled: management.disabling,
        onClick: () => void management.toggleDisabled(agent),
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
        onClick: () => void management.restart(agent),
      },
    },
  ];
  const environmentAccess: Action[] = accessListReach
    ? [
        {
          kind: "link",
          icon: <Cloud />,
          title: "Choose who may open Environments",
          description:
            "This agent has none yet and creates them itself. Name the people who may open the ones it creates.",
          onClick: () => navigateToSandboxHome(agent.id, "environments"),
        },
      ]
    : [];
  const removal: Action[] = [
    {
      kind: "button",
      icon: <TrashCan />,
      title: "Delete agent",
      description:
        "Delete the agent with its workspace and sessions. There is no going back.",
      button: {
        label: "Delete",
        disabled: management.deleting,
        onClick: () => void management.remove(agent),
        danger: true,
      },
    },
  ];

  const canDelete = holds(agent.access, "delete");
  const actions = [
    ...(holds(agent.access, "lifecycle") ? lifecycle : []),
    ...(holds(agent.access, "environments") ? environmentAccess : []),
    ...(canDelete ? removal : []),
  ];

  return (
    <>
      {actions.length > 0 && <ActionList label="Manage" actions={actions} />}
      {!canDelete && (
        <p
          className="mt-3 text-sm text-muted-foreground"
          data-testid="agent-delete-owner-only"
        >
          Only its owner, {ownerName(agent.access)}, can delete this agent.
        </p>
      )}
    </>
  );
}
