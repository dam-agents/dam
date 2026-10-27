import { cn } from "@/lib/utils";

import type { ActiveProvider } from "../context.js";
import { useInstantStart } from "../context.js";

type DemoState = "landing" | "low" | "exhausted" | null;

const PROVIDER_OPTIONS: { value: ActiveProvider; label: string }[] = [
  { value: "curvebender", label: "CurveBender" },
  { value: "ibm-litellm", label: "LiteLLM" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "bob", label: "Bob" },
];

export function InstantStartDebugControls() {
  const maybeCtx = useInstantStart();
  if (!maybeCtx) return null;
  const ctx = maybeCtx;

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
    <div className="fixed bottom-3 right-3 z-50 flex flex-col items-end gap-1.5 opacity-40 transition-opacity hover:opacity-100">
      <div className="flex items-center gap-1.5">
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
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">
          CurveBender payment:
        </span>
        <button
          type="button"
          onClick={() => {
            ctx.setCurveBenderPayment("free");
            ctx.setActiveProvider("curvebender");
            ctx.setConnectedProviderType(null);
            ctx.setCurveBenderEnabled(true);
          }}
          className={cn(btn, ctx.curveBenderPayment === "free" ? on : off)}
        >
          Free
        </button>
        <button
          type="button"
          onClick={() => {
            ctx.setCurveBenderPayment("own-key");
            ctx.setOwnCurveBenderKey(true);
            ctx.setOwnCurveBenderKeyLast4("7x2Q");
            ctx.setActiveProvider("curvebender");
            ctx.setConnectedProviderType(null);
          }}
          className={cn(btn, ctx.curveBenderPayment === "own-key" ? on : off)}
        >
          Your key
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Provider:</span>
        <select
          value={ctx.activeProvider}
          onChange={(e) => {
            const val = e.target.value as ActiveProvider;
            ctx.setActiveProvider(val);
            if (val === "curvebender") {
              ctx.setConnectedProviderType(null);
              ctx.setCurveBenderEnabled(true);
              ctx.setProviderAdded(false);
            } else {
              ctx.setConnectedProviderType(val);
              ctx.setProviderAdded(true);
            }
          }}
          className="rounded-md border border-border/50 bg-card/80 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur-sm"
        >
          {PROVIDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
