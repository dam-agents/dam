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

const CB_DESCRIPTION = "IBM Research’s open-model inference service.";

interface Props {
  onClose: () => void;
  initialShowKeyForm?: boolean;
}

export function ConfigureProviderModal({ onClose, initialShowKeyForm }: Props) {
  const ctx = useInstantStart();
  const [phase, setPhase] = useState<Phase>("pick");
  const [selected, setSelected] = useState<SelectionType | null>(null);

  const currentProvider = ctx?.connectedProviderType ?? null;
  const isCurveBender = ctx?.activeProvider === "curvebender";

  const budgetPct = ctx
    ? Math.round(
        ((ctx.freeBudget.limit - ctx.freeBudget.used) / ctx.freeBudget.limit) *
          100,
      )
    : 100;

  const budgetLabel = ctx?.budgetExhausted
    ? "Free budget — 0% remaining"
    : `Free budget — ${budgetPct}% remaining`;

  useEffect(() => {
    if (initialShowKeyForm && isCurveBender) {
      setSelected("curvebender");
      setPhase("form");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShowKeyForm]);

  const CURVEBENDER_OPTION: ProviderOption = {
    type: "curvebender",
    title: "CurveBender",
    description: CB_DESCRIPTION,
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

  return (
    <Modal widthClass="w-[505px]">
      <DialogHeader
        title="Configure provider"
        subtitle="Choose which provider this agent uses."
        onClose={onClose}
      />
      <DialogBody>
        {/* Selected / collapsed view */}
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
                {isCurveBender ? (
                  <>
                    CurveBender{" "}
                    <span className="font-normal text-muted-foreground">
                      ( Free budget )
                    </span>
                  </>
                ) : (
                  PROVIDERS[currentProvider!].displayName
                )}
              </p>
              <Badge variant="success">Active</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {isCurveBender
                ? CB_DESCRIPTION
                : (PROVIDER_ROWS.find((r) => r.type === currentProvider)
                    ?.description ?? "")}
            </p>
          </div>
          <ChevronDown
            size={18}
            className="shrink-0 text-muted-foreground rotate-180"
          />
        </button>

        {/* Dropdown list */}
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
                  <p className="truncate text-sm font-medium text-foreground">
                    {opt.title}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {opt.description}
                  </p>
                  {opt.type === "curvebender" && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {budgetLabel}
                    </p>
                  )}
                </div>
                {isActive ? (
                  <Checkmark size={16} className="shrink-0 text-foreground" />
                ) : (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    Connect
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
