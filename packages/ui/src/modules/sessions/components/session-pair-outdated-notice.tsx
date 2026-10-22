import { WarningAltFilled } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useAgentUpdateAction } from "../../agents/hooks/use-update-sandbox.js";

export function SessionPairOutdatedNotice({ agentId }: { agentId: string }) {
  const { agent, updateOne, pending } = useAgentUpdateAction(agentId);
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
              disabled={pending}
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
