import { cn } from "@/lib/utils";

import { useInstantStart } from "../context.js";

type DemoState = "landing" | "low" | "exhausted" | null;

export function InstantStartDebugControls() {
  const ctx = useInstantStart();
  if (!ctx) return null;

  const activeState: DemoState = ctx.budgetExhausted
    ? "exhausted"
    : ctx.firstLanding
      ? "landing"
      : ctx.freeBudget.used / ctx.freeBudget.limit >= 0.9
        ? "low"
        : null;

  function apply(state: DemoState) {
    const isActive = activeState === state;
    ctx.setBudgetExhausted(false);
    ctx.setFirstLanding(false);
    ctx.setBudgetUsed(0);
    if (isActive) return;
    switch (state) {
      case "landing":
        ctx.setFirstLanding(true);
        break;
      case "low":
        ctx.setBudgetUsed(ctx.freeBudget.limit * 0.9);
        break;
      case "exhausted":
        ctx.setBudgetExhausted(true);
        break;
    }
  }

  const btn =
    "rounded-md border px-2 py-1 text-[11px] backdrop-blur-sm transition-colors";
  const off =
    "border-border/50 bg-card/80 text-muted-foreground hover:bg-muted";
  const on = "border-primary/40 bg-primary/10 text-primary";

  return (
    <div className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 opacity-40 transition-opacity hover:opacity-100">
      <button
        type="button"
        onClick={() => apply("landing")}
        className={cn(btn, activeState === "landing" ? on : off)}
      >
        Landing
      </button>
      <button
        type="button"
        onClick={() => apply("low")}
        className={cn(btn, activeState === "low" ? on : off)}
      >
        10% left
      </button>
      <button
        type="button"
        onClick={() => apply("exhausted")}
        className={cn(btn, activeState === "exhausted" ? on : off)}
      >
        Budget up
      </button>
    </div>
  );
}
