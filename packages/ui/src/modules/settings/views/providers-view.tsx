import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CardButton } from "@/components/ui/card-button";
import { PageHeader } from "@/components/ui/page-header";

import { Modal } from "../../../components/modal.js";
import { useInstantStart } from "../../instant-start/context.js";
import { CurveBenderForm } from "../../providers/components/curvebender/form.js";
import { ProviderSection } from "../../providers/components/provider-section.js";

function CurveBenderProviderCard() {
  const ctx = useInstantStart();
  const [showDialog, setShowDialog] = useState(false);
  if (!ctx) return null;

  const {
    freeBudget,
    budgetExhausted,
    ownCurveBenderKey,
    ownCurveBenderKeyLast4,
  } = ctx;
  const budgetPct = Math.round(
    ((freeBudget.limit - freeBudget.used) / freeBudget.limit) * 100,
  );

  const handleSave = async (input: { value: string }) => {
    const last4 = input.value.slice(-4);
    ctx.setOwnCurveBenderKey(true);
    ctx.setOwnCurveBenderKeyLast4(last4);
    ctx.setCurveBenderPayment("own-key");
    ctx.setActiveProvider("curvebender");
    ctx.setConnectedProviderType(null);
    setShowDialog(false);
  };

  if (ownCurveBenderKey) {
    return (
      <Card className="flex items-center gap-1 pr-2 transition-colors">
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4">
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
                CurveBender
              </p>
              <Badge variant="success">Connected</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              IBM Research&apos;s open-model inference service.
            </p>
            {ownCurveBenderKeyLast4 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Key: ••••{ownCurveBenderKeyLast4}
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <CardButton
        onClick={() => setShowDialog(true)}
        className="flex w-full items-start gap-3 p-4"
      >
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <img
            src="/curvebender-logo.svg"
            alt="CurveBender"
            className="size-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-foreground">CurveBender</p>
          <p className="text-sm text-muted-foreground">
            IBM Research&apos;s open-model inference service.
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {budgetExhausted
              ? "Free budget — 0% remaining"
              : `Free budget — ${budgetPct}% remaining`}
          </p>
        </div>
        <span className="shrink-0 text-sm font-normal text-muted-foreground">
          Connect
        </span>
      </CardButton>

      {showDialog && (
        <Modal widthClass="w-[505px]">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CurveBenderForm
              onSave={handleSave}
              onCancel={() => setShowDialog(false)}
            />
          </div>
        </Modal>
      )}
    </>
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
