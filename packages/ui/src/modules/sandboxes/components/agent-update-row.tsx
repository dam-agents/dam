import { Renew } from "@carbon/icons-react";

import type { AgentView } from "../../../types.js";
import { UpdateAvailableAction } from "../../agents/components/update-available-action.js";
import { useUpdateSandbox } from "../../agents/hooks/use-update-sandbox.js";
import { ActionList } from "./action-list.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the newer sandbox an Agent can move to, as a row of its own at the top of the General page, apart from the rows that use and manage the Agent.
 */
export function AgentUpdateRow({ agent }: { agent: AgentView }) {
  const { updateOne, updatingId } = useUpdateSandbox();
  if (!agent.templateUpdate) return null;
  return (
    <ActionList
      actions={[
        {
          kind: "control",
          icon: <Renew />,
          title: "Update this agent",
          description: "A newer version of its sandbox is available.",
          control: (
            <UpdateAvailableAction
              agent={agent}
              pending={updatingId === agent.id}
              busy={updatingId !== null}
              onUpdate={() => void updateOne(agent)}
            />
          ),
        },
      ]}
    />
  );
}
