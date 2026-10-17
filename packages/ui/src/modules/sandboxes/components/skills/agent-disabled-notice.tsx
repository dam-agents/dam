import { Power } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

import { useSetAgentDisabled } from "../../../agents/api/mutations.js";

export function AgentDisabledNotice({ agentId }: { agentId: string }) {
  const setDisabled = useSetAgentDisabled();
  return (
    <Notice
      icon={Power}
      title="This agent is disabled"
      action={
        <Button
          size="sm"
          disabled={setDisabled.isPending}
          onClick={() => setDisabled.mutate({ id: agentId, disabled: false })}
        >
          Enable
        </Button>
      }
    >
      — its skills are read-only. Enable the agent to change them.
    </Notice>
  );
}
