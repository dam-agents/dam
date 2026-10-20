import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { useInstantStart } from "../../instant-start/context.js";
import { ProviderSection } from "../../providers/components/provider-section.js";

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function CurveBenderProviderCard() {
  const ctx = useInstantStart();
  if (!ctx) return null;

  const { freeBudget, budgetExhausted, curveBenderEnabled, setCurveBenderEnabled } = ctx;
  const active = curveBenderEnabled && !budgetExhausted;
  const pct = Math.min((freeBudget.used / freeBudget.limit) * 100, 100);

  return (
    <Card className={cn("relative px-4 py-4", !curveBenderEnabled && "opacity-60")}>
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
            <Badge variant={active ? "success" : "default"}>
              {budgetExhausted ? "Exhausted" : curveBenderEnabled ? "Active" : "Paused"}
            </Badge>
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
                active ? "bg-primary" : "bg-foreground",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="absolute right-3 top-3">
        <Switch
          checked={curveBenderEnabled}
          onCheckedChange={setCurveBenderEnabled}
          disabled={budgetExhausted}
          label="Toggle CurveBender budget"
        />
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
        <ProviderSection />
      </section>
    </div>
  );
}
