import { ArrowRight } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";
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
    <img src="/curvebender-logo.svg" alt="CurveBender" className={className} />
  );
}

export function FreeBudgetBanner({
  onConfigureProvider,
  onAddCurveBenderKey,
}: {
  onConfigureProvider?: () => void;
  onAddCurveBenderKey?: () => void;
}) {
  const ctx = useInstantStart();
  if (!ctx || ctx.connectedProviderType) return null;

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
              ? `${formatUsd(freeBudget.limit)} free budget used up — add your own key or switch provider`
              : `${formatUsd(freeBudget.used)} of ${formatUsd(freeBudget.limit)} used`}
          </p>
        </div>
        {budgetExhausted ? (
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={onAddCurveBenderKey}
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Add CurveBender key
            </button>
            <button
              type="button"
              onClick={onConfigureProvider}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Use another provider
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConfigureProvider}
            className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            Use own provider
            <ArrowRight size={16} />
          </button>
        )}
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
  if (!ctx || ctx.connectedProviderType) return null;

  const { freeBudget, budgetExhausted, curveBenderPayment } = ctx;

  const dollars =
    curveBenderPayment === "own-key"
      ? "Your key"
      : budgetExhausted
        ? "Budget used up"
        : `${formatUsd(freeBudget.used)} / ${formatUsd(freeBudget.limit)}`;

  const button = (
    <button
      type="button"
      onClick={() => navigateToSettings("providers")}
      className={cn(
        "flex h-[34px] w-full items-center gap-3 rounded-lg px-3 transition-colors",
        "text-foreground/80 hover:text-foreground hover:bg-muted",
      )}
    >
      <CurveBenderLogo className="size-4 shrink-0" />
      {expanded && (
        <>
          <span className="truncate text-sm font-medium">
            CurveBender budget
          </span>
          <span className="ml-auto shrink-0 text-sm text-muted-foreground">
            {dollars}
          </span>
        </>
      )}
    </button>
  );

  if (expanded) return button;
  return (
    <Tooltip content={`CurveBender budget — ${dollars}`} side="right">
      {button}
    </Tooltip>
  );
}
