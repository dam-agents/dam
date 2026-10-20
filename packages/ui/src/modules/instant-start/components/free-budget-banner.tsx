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

function CurveBenderLogo({ className }: { className?: string }) {
  return (
    <img
      src="/curvebender-logo.svg"
      alt="CurveBender"
      className={className}
    />
  );
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
        <CurveBenderLogo className="size-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {budgetExhausted
              ? "Free budget used up"
              : "Free budget from CurveBender"}
          </p>
          <p className="text-sm text-muted-foreground">
            {budgetExhausted
              ? `${formatUsd(freeBudget.limit)} free budget used up — connect a provider to continue`
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
            budgetExhausted ? "bg-foreground" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SidebarBudget({ expanded }: { expanded: boolean }) {
  const ctx = useInstantStart();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  if (!ctx) return null;

  const { freeBudget, budgetExhausted } = ctx;
  const pct = Math.min((freeBudget.used / freeBudget.limit) * 100, 100);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => navigateToSettings("providers")}
        className="group flex flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors hover:bg-muted"
        title={
          budgetExhausted
            ? "Free budget used up"
            : `${formatUsd(freeBudget.used)} of ${formatUsd(freeBudget.limit)}`
        }
      >
        <CurveBenderLogo className="size-5" />
        <div className="h-1 w-6 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full transition-all duration-500",
              budgetExhausted ? "bg-foreground" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigateToSettings("providers")}
      className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-muted"
    >
      <CurveBenderLogo className="size-5 shrink-0" />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-foreground">
          {budgetExhausted ? "Budget used up" : "CurveBender budget"}
        </p>
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full transition-all duration-500",
              budgetExhausted ? "bg-foreground" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {budgetExhausted
            ? "Connect a provider"
            : `${formatUsd(freeBudget.used)} / ${formatUsd(freeBudget.limit)}`}
        </p>
      </div>
    </button>
  );
}

