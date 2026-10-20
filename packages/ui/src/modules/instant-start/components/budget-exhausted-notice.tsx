import { ArrowRight } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useInstantStart } from "../context.js";

export function BudgetExhaustedNotice() {
  const ctx = useInstantStart();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  if (!ctx?.budgetExhausted) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm font-semibold text-foreground">
        Your free budget is used up
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your own LLM provider to keep chatting with this agent.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => navigateToSettings("providers")}
      >
        Connect a provider
        <ArrowRight size={16} className="ml-1.5" />
      </Button>
    </div>
  );
}
