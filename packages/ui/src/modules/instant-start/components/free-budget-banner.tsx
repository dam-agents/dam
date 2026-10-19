import { cn } from "@/lib/utils";

import { useInstantStart } from "../context.js";

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function FreeBudgetBanner() {
  const ctx = useInstantStart();
  if (!ctx) return null;

  const { freeBudget, budgetExhausted } = ctx;
  const pct = Math.min((freeBudget.used / freeBudget.limit) * 100, 100);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3",
        budgetExhausted
          ? "border-danger/30 bg-danger/5"
          : "border-info/30 bg-info/5",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {budgetExhausted ? "Free budget used up" : "Free starter budget"}
        </p>
        <p
          className={cn(
            "text-sm",
            budgetExhausted ? "text-danger" : "text-muted-foreground",
          )}
        >
          {formatUsd(freeBudget.used)} of {formatUsd(freeBudget.limit)} used
        </p>
      </div>
      <div className="w-24 shrink-0">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              budgetExhausted ? "bg-danger" : "bg-info",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
