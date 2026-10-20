import { ArrowRight } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useInstantStart } from "../context.js";

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function FreeBudgetBanner() {
  const ctx = useInstantStart();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  if (!ctx) return null;

  const { freeBudget, budgetExhausted } = ctx;
  const pct = Math.min((freeBudget.used / freeBudget.limit) * 100, 100);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <ProgressRing pct={pct} exhausted={budgetExhausted} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {budgetExhausted ? "Free budget used up" : "Free starter budget"}
          </p>
          <p className="text-sm text-muted-foreground">
            {budgetExhausted
              ? "Connect your own LLM provider to keep chatting"
              : `${formatUsd(freeBudget.used)} of ${formatUsd(freeBudget.limit)} used`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigateToSettings("providers")}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
        >
          {budgetExhausted ? "Connect provider" : "Use own provider"}
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="h-1.5 bg-muted">
        <div
          className={cn(
            "h-full transition-all duration-500",
            budgetExhausted ? "bg-muted-foreground/50" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ProgressRing({
  pct,
  exhausted,
}: {
  pct: number;
  exhausted: boolean;
}) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <svg viewBox="0 0 28 28" className="size-7 shrink-0 -rotate-90" aria-hidden>
      <circle
        cx={14}
        cy={14}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        className="text-muted"
      />
      <circle
        cx={14}
        cy={14}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={cn(
          "transition-all duration-500",
          exhausted ? "text-muted-foreground/50" : "text-primary",
        )}
      />
    </svg>
  );
}
