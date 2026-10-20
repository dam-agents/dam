import { Button } from "@/components/ui/button";

import { useInstantStart } from "../context.js";

export function InstantStartDebugControls() {
  const ctx = useInstantStart();
  if (!ctx) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-lg">
      <Button
        variant={ctx.budgetExhausted ? "destructive" : "outline"}
        size="sm"
        onClick={() => ctx.setBudgetExhausted(!ctx.budgetExhausted)}
      >
        {ctx.budgetExhausted ? "Budget: exhausted" : "Budget: active"}
      </Button>
      <Button
        variant={ctx.firstLanding ? "default" : "outline"}
        size="sm"
        onClick={() => ctx.setFirstLanding(!ctx.firstLanding)}
      >
        {ctx.firstLanding ? "First landing: on" : "First landing: off"}
      </Button>
    </div>
  );
}
