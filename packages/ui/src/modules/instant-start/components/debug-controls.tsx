import { useInstantStart } from "../context.js";

export function InstantStartDebugControls() {
  const ctx = useInstantStart();
  if (!ctx) return null;

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-1.5 opacity-40 transition-opacity hover:opacity-100">
      <button
        type="button"
        onClick={() => ctx.setBudgetExhausted(!ctx.budgetExhausted)}
        className="rounded-md border border-border/50 bg-card/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted"
      >
        {ctx.budgetExhausted ? "Budget: off" : "Budget: on"}
      </button>
      <button
        type="button"
        onClick={() => ctx.setFirstLanding(!ctx.firstLanding)}
        className="rounded-md border border-border/50 bg-card/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted"
      >
        {ctx.firstLanding ? "Landing: on" : "Landing: off"}
      </button>
    </div>
  );
}
