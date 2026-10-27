import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

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
  const isActive = activeProvider === "curvebender";
  const budgetPct = Math.round(
    ((freeBudget.limit - freeBudget.used) / freeBudget.limit) * 100,
  );

  const handleKeyFormSave = async (input: { value: string }) => {
    const last4 = input.value.slice(-4);
    ctx.setOwnCurveBenderKey(true);
    ctx.setOwnCurveBenderKeyLast4(last4);
    ctx.setCurveBenderPayment("own-key");
    ctx.setActiveProvider("curvebender");
    ctx.setConnectedProviderType(null);
    setShowKeyForm(false);
  };

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

          {curveBenderPayment === "own-key" &&
          ctx.ownCurveBenderKey &&
          !showKeyForm ? (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <img
                  src="/curvebender-logo.svg"
                  alt=""
                  className="size-3.5"
                />
                <span className="text-sm text-foreground">
                  ···· ···· ···· {ctx.ownCurveBenderKeyLast4 || "••••"}
                </span>
              </div>
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
          ) : showKeyForm ? (
            <div className="mt-3">
              <CurveBenderForm
                onSave={handleKeyFormSave}
                onCancel={() => setShowKeyForm(false)}
              />
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {budgetExhausted
                  ? "Free budget — 0% remaining"
                  : `Free budget — ${budgetPct}% remaining`}
              </span>
              <button
                type="button"
                onClick={() => setShowKeyForm(true)}
                className="text-sm font-medium text-[#0f62fe] hover:underline dark:text-[#78a9ff]"
              >
                Add your own key
              </button>
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
