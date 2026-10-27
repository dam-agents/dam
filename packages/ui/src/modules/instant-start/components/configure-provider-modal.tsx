import { Checkmark, ChevronDown } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import { CurveBenderForm } from "../../providers/components/curvebender/form.js";
import { IbmLitellmForm } from "../../providers/components/ibm-litellm/form.js";
import { PROVIDER_ROWS } from "../../providers/lib/provider-rows.js";
import { useInstantStart } from "../context.js";

type Phase = "pick" | "form" | "connecting" | "connected";
type SelectionType = ProviderPresetType | "curvebender";

interface ProviderOption {
  type: SelectionType;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const CB_ICON = (
  <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
    <img src="/curvebender-logo.svg" alt="CurveBender" className="size-5" />
  </div>
);

const CB_ICON_SM = (
  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
    <img src="/curvebender-logo.svg" alt="CurveBender" className="size-3.5" />
  </div>
);

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function PaymentToggle({
  value,
  onChange,
}: {
  value: "free" | "own-key";
  onChange: (v: "free" | "own-key") => void;
}) {
  return (
    <div className="flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
      <button
        type="button"
        onClick={() => onChange("free")}
        className={cn(
          "flex-1 rounded-md px-3 text-xs font-medium transition-colors",
          value === "free"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Free budget
      </button>
      <button
        type="button"
        onClick={() => onChange("own-key")}
        className={cn(
          "flex-1 rounded-md px-3 text-xs font-medium transition-colors",
          value === "own-key"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Your key
      </button>
    </div>
  );
}

interface Props {
  onClose: () => void;
  initialShowKeyForm?: boolean;
}

export function ConfigureProviderModal({ onClose, initialShowKeyForm }: Props) {
  const ctx = useInstantStart();
  const [phase, setPhase] = useState<Phase>("pick");
  const [selected, setSelected] = useState<SelectionType | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(!!initialShowKeyForm);

  const currentProvider = ctx?.connectedProviderType ?? null;
  const isCurveBender = ctx?.activeProvider === "curvebender";

  useEffect(() => {
    if (initialShowKeyForm && isCurveBender) {
      ctx?.setCurveBenderPayment("own-key");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShowKeyForm]);

  function getCurveBenderDescription() {
    if (!ctx) return "";
    if (ctx.curveBenderPayment === "own-key") {
      return ctx.ownCurveBenderKey
        ? `Your key (···${ctx.ownCurveBenderKeyLast4 || "••••"})`
        : "Your own API key";
    }
    const { freeBudget, budgetExhausted } = ctx;
    if (budgetExhausted)
      return `${formatUsd(freeBudget.limit)} free budget used up`;
    return `Free budget — ${formatUsd(freeBudget.used)} of ${formatUsd(freeBudget.limit)} used`;
  }

  const CURVEBENDER_OPTION: ProviderOption = {
    type: "curvebender",
    title: "CurveBender",
    description: getCurveBenderDescription(),
    icon: CB_ICON_SM,
  };

  const allOptions: ProviderOption[] = [
    CURVEBENDER_OPTION,
    ...PROVIDER_ROWS.map((row) => ({
      type: row.type as SelectionType,
      title: PROVIDERS[row.type].displayName,
      description: row.description,
      icon: <CardIcon provider={row.type} size="sm" />,
    })),
  ];

  const handleSelect = (opt: ProviderOption) => {
    if (opt.type === "curvebender") {
      ctx?.setConnectedProviderType(null);
      ctx?.setActiveProvider("curvebender");
      ctx?.setCurveBenderEnabled(true);
      if (!ctx?.ownCurveBenderKey) {
        ctx?.setCurveBenderPayment("free");
      }
      onClose();
      return;
    }

    if (opt.type === "ibm-litellm") {
      setSelected(opt.type);
      setPhase("form");
      return;
    }

    const providerType = opt.type as ProviderPresetType;
    if (providerType === currentProvider) return;
    setSelected(providerType);
    setPhase("connecting");
  };

  useEffect(() => {
    if (phase !== "connecting" || !selected) return;
    const t = setTimeout(() => {
      const providerType = selected as ProviderPresetType;
      ctx?.setConnectedProviderType(providerType);
      ctx?.setProviderAdded(true);
      ctx?.setActiveProvider(providerType);
      setPhase("connected");
    }, 1200);
    return () => clearTimeout(t);
  }, [phase, selected, ctx]);

  useEffect(() => {
    if (phase !== "connected") return;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  const selectedName = selected
    ? selected === "curvebender"
      ? "CurveBender"
      : PROVIDERS[selected as ProviderPresetType].displayName
    : "";

  if (phase === "form" && selected) {
    const handleFormSave = async (input: { value: string }) => {
      if (selected === "curvebender") {
        const last4 = input.value.slice(-4);
        ctx?.setOwnCurveBenderKey(true);
        ctx?.setOwnCurveBenderKeyLast4(last4);
        ctx?.setCurveBenderPayment("own-key");
        ctx?.setActiveProvider("curvebender");
        ctx?.setConnectedProviderType(null);
      } else if (selected === "ibm-litellm") {
        ctx?.setConnectedProviderType("ibm-litellm");
        ctx?.setProviderAdded(true);
        ctx?.setActiveProvider("ibm-litellm");
      }
      setPhase("connected");
    };

    return (
      <Modal widthClass="w-[505px]">
        {selected === "curvebender" ? (
          <CurveBenderForm
            onSave={handleFormSave}
            onCancel={() => setPhase("pick")}
          />
        ) : (
          <IbmLitellmForm
            variant="wizard"
            onSave={handleFormSave}
            onCancel={() => setPhase("pick")}
          />
        )}
      </Modal>
    );
  }

  if (phase === "connecting") {
    return (
      <Modal widthClass="w-[505px]">
        <div className="flex flex-col items-center gap-4 px-8 py-12">
          <div className="size-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-sm font-medium text-foreground">
            Connecting to {selectedName}...
          </p>
        </div>
      </Modal>
    );
  }

  if (phase === "connected") {
    return (
      <Modal widthClass="w-[505px]">
        <div className="flex flex-col items-center gap-4 px-8 py-12">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary">
            <Checkmark size={20} className="text-primary-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {selectedName} connected
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your agent will now use {selectedName}.
              {!isCurveBender && " CurveBender budget paused."}
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  const activeType: SelectionType = currentProvider ?? "curvebender";

  const handlePaymentChange = (v: "free" | "own-key") => {
    ctx?.setCurveBenderPayment(v);
    if (v === "own-key" && !ctx?.ownCurveBenderKey) {
      setShowKeyForm(true);
    } else {
      setShowKeyForm(false);
    }
  };

  const handleKeyFormSave = async (input: { value: string }) => {
    const last4 = input.value.slice(-4);
    ctx?.setOwnCurveBenderKey(true);
    ctx?.setOwnCurveBenderKeyLast4(last4);
    ctx?.setCurveBenderPayment("own-key");
    ctx?.setActiveProvider("curvebender");
    ctx?.setConnectedProviderType(null);
    setShowKeyForm(false);
  };

  return (
    <Modal widthClass="w-[505px]">
      <DialogHeader
        title="Configure provider"
        subtitle="Choose which provider this agent uses."
        onClose={onClose}
      />
      <DialogBody>
        <button
          type="button"
          className={cn(
            CARD_SURFACE,
            "group flex min-h-[76px] w-full items-center gap-3.5 p-4 text-left border-foreground",
          )}
        >
          {isCurveBender ? CB_ICON : <CardIcon provider={currentProvider!} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <p className="truncate text-base font-medium text-foreground">
                {isCurveBender
                  ? "CurveBender"
                  : PROVIDERS[currentProvider!].displayName}
              </p>
              <Badge variant="success">Active</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {isCurveBender
                ? getCurveBenderDescription()
                : (PROVIDER_ROWS.find((r) => r.type === currentProvider)
                    ?.description ?? "")}
            </p>
          </div>
          <ChevronDown
            size={18}
            className="shrink-0 text-muted-foreground rotate-180"
          />
        </button>

        {isCurveBender && (
          <div className="mt-3 space-y-3">
            <PaymentToggle
              value={ctx?.curveBenderPayment ?? "free"}
              onChange={handlePaymentChange}
            />
            {ctx?.curveBenderPayment === "own-key" && showKeyForm && (
              <div className="rounded-lg border border-border p-3">
                <CurveBenderForm
                  onSave={handleKeyFormSave}
                  onCancel={() => {
                    ctx?.setCurveBenderPayment("free");
                    setShowKeyForm(false);
                  }}
                />
              </div>
            )}
            {ctx?.curveBenderPayment === "own-key" &&
              ctx.ownCurveBenderKey &&
              !showKeyForm && (
                <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    {CB_ICON_SM}
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
              )}
          </div>
        )}

        <div className="mt-2 rounded-lg border border-border bg-popover p-1.5 shadow-md">
          {allOptions.map((opt) => {
            const isActive = opt.type === activeType;
            return (
              <button
                key={opt.type}
                type="button"
                onClick={() => handleSelect(opt)}
                className={cn(
                  "flex h-auto w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                  isActive && "bg-muted/50",
                )}
              >
                {opt.icon}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {opt.title}
                    </p>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
                {isActive ? (
                  <Checkmark size={16} className="shrink-0 text-foreground" />
                ) : (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {opt.type === "curvebender" ? "Free" : "Connect"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DialogBody>
    </Modal>
  );
}
