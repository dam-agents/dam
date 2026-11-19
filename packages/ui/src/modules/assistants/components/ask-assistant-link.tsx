import { FOCUS_RING } from "@/components/ui/focus-ring";
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
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        ask(prefill);
      }}
      className={cn(
        "self-start rounded-xs text-xs text-accent underline underline-offset-2 hover:no-underline",
        FOCUS_RING,
        className,
      )}
    >
      {label}
    </button>
  );
}
