import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RichSelect, type RichSelectOption } from "@/components/ui/rich-select";

import { Modal } from "../../../components/modal.js";
import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { useInstantStart } from "../../instant-start/context.js";
import { CurveBenderForm } from "../components/curvebender/form.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { offeredProviderRows } from "../lib/provider-rows.js";
import { CardIcon } from "./card-icon.js";
import { IbmLitellmForm } from "./ibm-litellm/form.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { type ProviderRef, providerRef } from "./provider-item.js";

const CURVEBENDER_TYPE = "curvebender" as ProviderPresetType;

interface Props {
  selected: ProviderRef | null;
  onSelect: (ref: ProviderRef | null) => void;
  confirmSwitch?: () => Promise<boolean>;
  autoSelectFirst?: boolean;
  disabled?: boolean;
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
  const [showCbKeyForm, setShowCbKeyForm] = useState(false);
  const [showLitellmForm, setShowLitellmForm] = useState(false);
  const rows = useMemo(
    () => offeredProviderRows(allow, recommended),
    [allow, recommended],
  );

  const isConnected = (type: ProviderPresetType) =>
    itemByType.has(type) || instantStart?.connectedProviderType === type;

  const showCurveBender = !!instantStart && !instantStart.connectedProviderType;

  const cbHasOwnKey = !!instantStart?.ownCurveBenderKey;

  const resolvedType = selected
    ? (typeByConnectionId.get(selected.id) ??
      (connected?.id === selected.id ? connected.type : null))
    : null;

  const selectedType =
    resolvedType && rows.some((row) => row.type === resolvedType)
      ? resolvedType
      : instantStart?.connectedProviderType &&
          rows.some((row) => row.type === instantStart.connectedProviderType)
        ? instantStart.connectedProviderType
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
    if (type === CURVEBENDER_TYPE) {
      if (!cbHasOwnKey) setShowCbKeyForm(true);
      return;
    }
    if (type === selectedType) return;
    if (
      selectedType &&
      selectedType !== CURVEBENDER_TYPE &&
      confirmSwitch &&
      !(await confirmSwitch())
    )
      return;

    if (instantStart) {
      if (isConnected(type)) {
        instantStart.setConnectedProviderType(type);
        instantStart.setActiveProvider(type);
        instantStart.setProviderAdded(true);
        const fakeRef: ProviderRef = { id: `instant-${type}` };
        setConnected({ id: fakeRef.id, type });
        onSelect(fakeRef);
        return;
      }
      if (type === "ibm-litellm") {
        setShowLitellmForm(true);
        return;
      }
      setConnecting(type);
      return;
    }

    const item = itemByType.get(type);
    if (!item) {
      setConnecting(type);
      return;
    }
    onSelect(providerRef(item));
  };

  const handleConnected = (ref: ProviderRef) => {
    if (instantStart && connecting) {
      instantStart.setConnectedProviderType(connecting);
      instantStart.setActiveProvider(connecting);
      instantStart.setProviderAdded(true);
    }
    setConnected({ id: ref.id, type: connecting! });
    onSelect(ref);
    setConnecting(null);
  };

  const handleLitellmSave = async () => {
    if (!instantStart) return;
    instantStart.setConnectedProviderType("ibm-litellm" as ProviderPresetType);
    instantStart.setActiveProvider("ibm-litellm" as ProviderPresetType);
    instantStart.setProviderAdded(true);
    const fakeRef: ProviderRef = { id: "instant-ibm-litellm" };
    setConnected({ id: fakeRef.id, type: "ibm-litellm" as ProviderPresetType });
    onSelect(fakeRef);
    setShowLitellmForm(false);
  };

  const handleCbKeySave = async (input: { value: string }) => {
    if (!instantStart) return;
    const last4 = input.value.slice(-4);
    instantStart.setOwnCurveBenderKey(true);
    instantStart.setOwnCurveBenderKeyLast4(last4);
    instantStart.setCurveBenderPayment("own-key");
    instantStart.setActiveProvider("curvebender");
    instantStart.setConnectedProviderType(null);
    setShowCbKeyForm(false);
  };

  if (isPending) return <Card className="h-[76px] animate-pulse" />;

  const budgetPct = instantStart
    ? Math.round(
        ((instantStart.freeBudget.limit - instantStart.freeBudget.used) /
          instantStart.freeBudget.limit) *
          100,
      )
    : 100;

  const budgetLabel = instantStart?.budgetExhausted
    ? "Free budget — 0% remaining"
    : `Free budget - ${budgetPct}% remaining`;

  function getCurveBenderDropdownDescription(): ReactNode {
    if (!instantStart) return "IBM Research’s open-model inference service.";
    if (cbHasOwnKey) return "IBM Research’s open-model inference service.";
    return (
      <>
        <span>IBM Research&#39;s open-model inference service.</span>
        <br />
        <span className="text-xs text-muted-foreground">{budgetLabel}</span>
      </>
    );
  }

  const options: RichSelectOption<ProviderPresetType>[] = [];

  if (showCurveBender) {
    options.push({
      value: CURVEBENDER_TYPE,
      title: "CurveBender",
      triggerTitle: "CurveBender",
      triggerDescription: "IBM Research’s open-model inference service.",
      triggerBadge: cbHasOwnKey ? (
        <Badge variant="success">Connected</Badge>
      ) : (
        <span className="text-sm font-normal text-muted-foreground">
          {budgetLabel}
        </span>
      ),
      triggerTrailing: cbHasOwnKey ? undefined : (
        <span className="shrink-0 text-sm font-normal text-primary">
          Add your key
        </span>
      ),
      description: getCurveBenderDropdownDescription(),
      icon: (
        <img src="/curvebender-logo.svg" alt="" className="size-6 shrink-0" />
      ),
      trailing: cbHasOwnKey ? undefined : (
        <span className="shrink-0 text-sm text-muted-foreground">Connect</span>
      ),
      hideCheck: !cbHasOwnKey,
      testId: "provider-option-curvebender",
    });
  }

  for (const row of rows) {
    const rowConnected = isConnected(row.type);
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
      triggerBadge: rowConnected ? (
        <Badge variant="success">Connected</Badge>
      ) : undefined,
      trailing: rowConnected ? undefined : (
        <span className="shrink-0 text-sm text-muted-foreground">Connect</span>
      ),
      testId: `provider-option-${row.type}`,
    });
  }

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

      {connecting && (
        <ProviderConnectDialog
          provider={connecting}
          onConnected={handleConnected}
          onClose={() => setConnecting(null)}
        />
      )}

      {showCbKeyForm && (
        <Modal widthClass="w-[505px]">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CurveBenderForm
              onSave={handleCbKeySave}
              onCancel={() => setShowCbKeyForm(false)}
            />
          </div>
        </Modal>
      )}

      {showLitellmForm && (
        <Modal widthClass="w-[505px]">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IbmLitellmForm
              variant="wizard"
              onSave={handleLitellmSave}
              onCancel={() => setShowLitellmForm(false)}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
