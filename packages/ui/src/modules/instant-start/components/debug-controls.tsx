import { Button } from "@/components/ui/button";

import { useInstantStart } from "../context.js";

export function InstantStartDebugControls() {
  const ctx = useInstantStart();
  if (!ctx) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Approach {ctx.approach}
      </p>
      <Button
        variant={ctx.budgetExhausted ? "destructive" : "outline"}
        size="sm"
        onClick={() => ctx.setBudgetExhausted(!ctx.budgetExhausted)}
      >
        {ctx.budgetExhausted ? "Budget: exhausted" : "Budget: active"}
      </Button>
      <Button
        variant={ctx.providerAdded ? "default" : "outline"}
        size="sm"
        onClick={() => ctx.setProviderAdded(!ctx.providerAdded)}
      >
        {ctx.providerAdded ? "Own provider: yes" : "Own provider: no"}
      </Button>
      <Button
        variant={ctx.agentCreated ? "default" : "outline"}
        size="sm"
        onClick={() => ctx.setAgentCreated(!ctx.agentCreated)}
      >
        {ctx.agentCreated ? "Agent: created" : "Agent: creating…"}
      </Button>
    </div>
  );
}
