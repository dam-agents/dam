import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { useStore } from "../../../store.js";
import { useInstantStart } from "../context.js";

export function BudgetExhaustedNotice() {
  const ctx = useInstantStart();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  if (!ctx?.budgetExhausted) return null;

  return (
    <Callout tone="danger">
      <p className="text-sm font-medium text-foreground">
        Free budget used up
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Your free starter budget has been fully used. Connect your own LLM
        provider to keep chatting with this agent.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => navigateToSettings("providers")}
      >
        Connect a provider
      </Button>
    </Callout>
  );
}
