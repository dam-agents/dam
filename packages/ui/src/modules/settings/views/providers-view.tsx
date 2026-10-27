import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { useInstantStart } from "../../instant-start/context.js";
import { ProviderSection } from "../../providers/components/provider-section.js";
import { CURVE_BENDER_DESCRIPTION } from "../../providers/lib/provider-rows.js";

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function CurveBenderProviderCard() {
  const ctx = useInstantStart();
  if (!ctx) return null;

  const { freeBudget, budgetExhausted, activeProvider } = ctx;
  const pct = Math.min((freeBudget.used / freeBudget.limit) * 100, 100);
  const isActive = activeProvider === "curvebender-free";

  return (
    <Card className="px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <img
            src="/curvebender-logo.svg"
            alt="CurveBender"
            className="size-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-medium text-foreground">CurveBender</p>
            {isActive && <Badge variant="success">Active</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {budgetExhausted
              ? `${formatUsd(freeBudget.limit)} free budget used up`
              : `Free budget — ${formatUsd(freeBudget.used)} of ${formatUsd(freeBudget.limit)} used`}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full transition-all duration-500",
                budgetExhausted ? "bg-foreground" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          {!isActive && !budgetExhausted && (
            <button
              type="button"
              onClick={() => {
                ctx.setActiveProvider("curvebender-free");
                ctx.setCurveBenderEnabled(true);
                ctx.setConnectedProviderType(null);
              }}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              Switch back to free budget
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function CurveBenderOwnKeyCard() {
  const ctx = useInstantStart();
  if (!ctx?.ownCurveBenderKey) return null;

  const isActive = ctx.activeProvider === "curvebender-own";

  return (
    <Card className="px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <img
            src="/curvebender-logo.svg"
            alt="CurveBender"
            className="size-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-medium text-foreground">
              CurveBender (own key)
            </p>
            {isActive && <Badge variant="success">Active</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {CURVE_BENDER_DESCRIPTION}
          </p>
          {!isActive && (
            <button
              type="button"
              onClick={() => {
                ctx.setActiveProvider("curvebender-own");
                ctx.setProviderAdded(true);
              }}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              Switch to own key
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ProvidersView() {
  return (
    <div className="w-full max-w-2xl">
      <PageHeader
        title="Providers"
        description="Agents need an API key from a provider to reach a model."
      />

      <section className="mb-8 flex flex-col gap-3">
        <CurveBenderProviderCard />
        <CurveBenderOwnKeyCard />
        <ProviderSection />
      </section>
    </div>
  );
}
