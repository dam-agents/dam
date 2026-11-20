import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useAgent } from "../../agents/api/queries.js";
import { useAskAssistant } from "../hooks/use-ask-assistant.js";

interface Props {
  agentId: string | null | undefined;
  prefill: string;
  className?: string;
}

export function AskAssistantLink({ agentId, prefill, className }: Props) {
  const agent = useAgent(agentId ?? null);
  const { offered, label, ask } = useAskAssistant();
  if (!offered(agent)) return null;
  return (
    <Button
      variant="link"
      size="inline"
      className={cn("text-sm", className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        ask(prefill);
      }}
    >
      {label}
    </Button>
  );
}
