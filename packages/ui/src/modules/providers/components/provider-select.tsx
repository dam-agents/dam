import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RichSelect, type RichSelectOption } from "@/components/ui/rich-select";
import { cn } from "@/lib/utils";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { useInstantStart } from "../../instant-start/context.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { offeredProviderRows } from "../lib/provider-rows.js";
import { CardIcon } from "./card-icon.js";
import { CurveBenderForm } from "./curvebender/form.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { type ProviderRef, providerRef } from "./provider-item.js";

const CURVEBENDER_TYPE = "curvebender" as ProviderPresetType;

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface Props {
  selected: ProviderRef | null;
  onSelect: (ref: ProviderRef | null) => void;
  confirmSwitch?: () => Promise<boolean>;
  autoSelectFirst?: boolean;
  disabled?: boolean;
  required?: boolean;
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
  defaultOpen?: boolean;
}

export function ProviderSelect({
  selected,
  onSelect,
  confirmSwitch,
  autoSelectFirst = false,
  disabled = false,
  required = false,
  allow,
  recommended,
  defaultOpen,
}: Props) {
  const { itemByType, typeByConnectionId, isPending, isSuccess } =
    useProviderItems();
  const instantStart = useInstantStart();
  const [connecting, setConnecting] = useState<ProviderPresetType | null>(null);
  const [connected, setConnected] = useState<{
    id: string;
    type: ProviderPresetType;
  } | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const rows = useMemo(
    () => offeredProviderRows(allow, recommended),
    [allow, recommended],
  );

  const showCurveBender = !!instantStart && !instantStart.connectedProviderType;

  const resolvedType = selected
    ? (typeByConnectionId.get(selected.id) ??
      (connected?.id === selected.id ? connected.type : null))
    : null;
  const selectedType =
    resolvedType && rows.some((row) => row.type === resolvedType)
      ? resolvedType
      : showCurveBender
        ? CURVEBENDER_TYPE
        : null;

  const autoSelectTarget = useMemo(
    () =>
      autoSelectFirst
        ? rows.map((r) => itemByType.get(r.type)).find(Boolean)
        : undefined,
    [autoSelectFirst, rows, itemByType],
  );

  useEffect(() => {
    if (!isSuccess || selectedType) return;
    if (autoSelectTarget) {
      onSelect(providerRef(autoSelectTarget));
    } else if (selected) {
      onSelect(null);
    }
  }, [isSuccess, selectedType, autoSelectTarget, selected, onSelect]);

  const pick = async (type: ProviderPresetType) => {
    if (type === CURVEBENDER_TYPE) return;
    if (type === selectedType) return;
    if (
      selectedType &&
      selectedType !== CURVEBENDER_TYPE &&
      confirmSwitch &&
      !(await confirmSwitch())
    )
      return;
    const item = itemByType.get(type);
    if (!item) {
      setConnecting(type);
      return;
    }
    onSelect(providerRef(item));
  };

  if (isPending) return <Card className="h-[76px] animate-pulse" />;

  const cbPayment = instantStart?.curveBenderPayment ?? "free";

  function getCurveBenderDescription() {
    if (!instantStart) return "Free sponsored budget — no API key required.";
    if (cbPayment === "own-key") {
      return instantStart.ownCurveBenderKey
        ? `Your key (···${instantStart.ownCurveBenderKeyLast4 || "••••"})`
        : "Your own API key";
    }
    const { freeBudget, budgetExhausted } = instantStart;
    if (budgetExhausted)
      return `${formatUsd(freeBudget.limit)} free budget used up`;
    return `Free budget — ${formatUsd(freeBudget.used)} of ${formatUsd(freeBudget.limit)} used`;
  }

  const options: RichSelectOption<ProviderPresetType>[] = [];

  if (showCurveBender) {
    options.push({
      value: CURVEBENDER_TYPE,
      title: "CurveBender",
      description: getCurveBenderDescription(),
      icon: (
        <img src="/curvebender-logo.svg" alt="" className="size-6 shrink-0" />
      ),
      triggerIcon: (
        <img src="/curvebender-logo.svg" alt="" className="size-9 shrink-0" />
      ),
      triggerBadge: <Badge variant="success">Active</Badge>,
      testId: "provider-option-curvebender",
    });
  }

  for (const row of rows) {
    options.push({
      value: row.type,
      title: PROVIDERS[row.type].displayName,
      description: row.description,
      icon: <CardIcon provider={row.type} size="sm" />,
      triggerIcon: <CardIcon provider={row.type} />,
      badge:
        row.type === recommended ? (
          <Badge variant="muted">Recommended</Badge>
        ) : undefined,
      triggerBadge: itemByType.has(row.type) ? (
        <Badge variant="success">Connected</Badge>
      ) : undefined,
      trailing: itemByType.has(row.type) ? undefined : (
        <span className="shrink-0 text-sm text-muted-foreground">Connect</span>
      ),
      testId: `provider-option-${row.type}`,
    });
  }

  const isCurveBenderSelected = selectedType === CURVEBENDER_TYPE;

  const handlePaymentChange = (v: "free" | "own-key") => {
    instantStart?.setCurveBenderPayment(v);
    if (v === "own-key" && !instantStart?.ownCurveBenderKey) {
      setShowKeyForm(true);
    } else {
      setShowKeyForm(false);
    }
  };

  const handleKeyFormSave = async (input: { value: string }) => {
    const last4 = input.value.slice(-4);
    instantStart?.setOwnCurveBenderKey(true);
    instantStart?.setOwnCurveBenderKeyLast4(last4);
    instantStart?.setCurveBenderPayment("own-key");
    instantStart?.setActiveProvider("curvebender");
    instantStart?.setConnectedProviderType(null);
    setShowKeyForm(false);
  };

  return (
    <>
      <RichSelect
        options={options}
        value={selectedType}
        onSelect={(type) => void pick(type)}
        placeholder="Select a provider"
        ariaLabel="Provider"
        disabled={disabled}
        invalid={false}
        testId="provider-select"
        defaultOpen={defaultOpen}
      />

      {isCurveBenderSelected && instantStart && (
        <div className="mt-3 space-y-3">
          <div className="flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => handlePaymentChange("free")}
              className={cn(
                "flex-1 rounded-md px-3 text-xs font-medium transition-colors",
                cbPayment === "free"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Free budget
            </button>
            <button
              type="button"
              onClick={() => handlePaymentChange("own-key")}
              className={cn(
                "flex-1 rounded-md px-3 text-xs font-medium transition-colors",
                cbPayment === "own-key"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Your key
            </button>
          </div>

          {cbPayment === "own-key" && showKeyForm && (
            <div className="rounded-lg border border-border p-3">
              <CurveBenderForm
                onSave={handleKeyFormSave}
                onCancel={() => {
                  instantStart.setCurveBenderPayment("free");
                  setShowKeyForm(false);
                }}
              />
            </div>
          )}

          {cbPayment === "own-key" &&
            instantStart.ownCurveBenderKey &&
            !showKeyForm && (
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <img
                    src="/curvebender-logo.svg"
                    alt=""
                    className="size-3.5"
                  />
                  <span className="text-sm text-foreground">
                    ···· ···· ···· {instantStart.ownCurveBenderKeyLast4 || "••••"}
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
                      instantStart.setOwnCurveBenderKey(false);
                      instantStart.setOwnCurveBenderKeyLast4("");
                      instantStart.setCurveBenderPayment("free");
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

      {connecting && (
        <ProviderConnectDialog
          provider={connecting}
          onConnected={(ref) => {
            setConnected({ id: ref.id, type: connecting });
            onSelect(ref);
            setConnecting(null);
          }}
          onClose={() => setConnecting(null)}
        />
      )}
    </>
  );
}
