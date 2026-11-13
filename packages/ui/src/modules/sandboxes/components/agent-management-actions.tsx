import { Cloud, Restart, TrashCan } from "@carbon/icons-react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { holds, ownerName } from "../../agents/lib/agent-permissions.js";
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
  const environments = useEnvironments(environmentsEnabled ? agent.id : null);
  const accessListReach = environments.data?.length === 0;

  const lifecycle: Action[] = [
    {
      kind: "button",
      icon: <Restart />,
      title: "Restart agent",
      description:
        display.powerAction === "restart"
          ? "Interrupt in-flight work and start the agent fresh."
          : display.powerAction === "start"
            ? "The agent is not running. It starts fresh the next time it is used."
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
