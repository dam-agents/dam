import { WarningAltFilled } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useAgentsList } from "../../agents/api/queries.js";
import { useUpdateSandbox } from "../../agents/hooks/use-update-sandbox.js";

export function SessionPairOutdatedNotice({ agentId }: { agentId: string }) {
  const agents = useAgentsList();
  const { updateOne, updatingId } = useUpdateSandbox();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  return (
    <p
      role="status"
      className="flex items-center gap-1.5 pl-3 text-sm text-muted-foreground"
    >
      <WarningAltFilled
        size={16}
        className="shrink-0 text-warning"
        aria-hidden
      />
      <span>
        This agent is outdated.
        {agent.templateUpdate && (
          <>
            {" "}
            <Button
              variant="link"
              size="inline"
              disabled={updatingId === agent.id}
              onClick={() => void updateOne(agent)}
            >
              Update
            </Button>{" "}
            to be able to configure models.
          </>
        )}
      </span>
    </p>
  );
}
