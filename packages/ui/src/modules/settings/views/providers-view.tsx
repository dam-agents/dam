import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { useInstantStart } from "../../instant-start/context.js";
import { CurveBenderForm } from "../../providers/components/curvebender/form.js";
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
  const [showKeyForm, setShowKeyForm] = useState(false);
  if (!ctx) return null;

  const { freeBudget, budgetExhausted, activeProvider, curveBenderPayment } =
    ctx;
  const pct = Math.min((freeBudget.used / freeBudget.limit) * 100, 100);
  const isActive = activeProvider === "curvebender";

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
            {CURVE_BENDER_DESCRIPTION}
          </p>

          <div className="mt-3 flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => {
                ctx.setCurveBenderPayment("free");
                ctx.setActiveProvider("curvebender");
                ctx.setCurveBenderEnabled(true);
                setShowKeyForm(false);
              }}
              className={cn(
                "flex-1 rounded-md px-3 text-xs font-medium transition-colors",
                curveBenderPayment === "free"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Free budget
            </button>
            <button
              type="button"
              onClick={() => {
                ctx.setCurveBenderPayment("own-key");
                ctx.setActiveProvider("curvebender");
                if (!ctx.ownCurveBenderKey) setShowKeyForm(true);
                else setShowKeyForm(false);
              }}
              className={cn(
                "flex-1 rounded-md px-3 text-xs font-medium transition-colors",
                curveBenderPayment === "own-key"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Your key
            </button>
          </div>

          {curveBenderPayment === "free" && (
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">
                {budgetExhausted
                  ? `${formatUsd(freeBudget.limit)} free budget used up`
                  : `${formatUsd(freeBudget.used)} of ${formatUsd(freeBudget.limit)} used`}
              </p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-all duration-500",
                    budgetExhausted ? "bg-foreground" : "bg-primary",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {curveBenderPayment === "own-key" && showKeyForm && (
            <div className="mt-3 rounded-lg border border-border p-3">
              <CurveBenderForm
                onSave={async (input) => {
                  const last4 = input.value.slice(-4);
                  ctx.setOwnCurveBenderKey(true);
                  ctx.setOwnCurveBenderKeyLast4(last4);
                  setShowKeyForm(false);
                }}
                onCancel={() => {
                  ctx.setCurveBenderPayment("free");
                  setShowKeyForm(false);
                }}
              />
            </div>
          )}

          {curveBenderPayment === "own-key" &&
            ctx.ownCurveBenderKey &&
            !showKeyForm && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <span className="text-sm text-foreground">
                  ···· ···· ···· {ctx.ownCurveBenderKeyLast4 || "••••"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowKeyForm(true)}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      ctx.setOwnCurveBenderKey(false);
                      ctx.setOwnCurveBenderKeyLast4("");
                      ctx.setCurveBenderPayment("free");
                      setShowKeyForm(false);
                    }}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

          {!isActive && (
            <button
              type="button"
              onClick={() => {
                ctx.setActiveProvider("curvebender");
                ctx.setCurveBenderEnabled(true);
                ctx.setConnectedProviderType(null);
              }}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              Switch to CurveBender
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
        <ProviderSection />
      </section>
    </div>
  );
}
