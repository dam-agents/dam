import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RichSelect, type RichSelectOption } from "@/components/ui/rich-select";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import {
  offeredProviderRows,
  type ProviderChoice,
  providerChoices,
} from "../lib/provider-rows.js";
import { CardIcon } from "./card-icon.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { type ProviderRef, providerRef } from "./provider-item.js";

interface Props {
  selected: ProviderRef | null;
  onSelect: (ref: ProviderRef | null) => void;
  confirmSwitch?: () => Promise<boolean>;
  autoSelectFirst?: boolean;
  disabled?: boolean;
  required?: boolean;
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
  preferShared?: boolean;
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
  preferShared = false,
}: Props) {
  const { itemByType, shared, typeByConnectionId, isPending, isSuccess } =
    useProviderItems();
  const [connecting, setConnecting] = useState<ProviderPresetType | null>(null);
  const [connected, setConnected] = useState<{
    id: string;
    type: ProviderPresetType;
  } | null>(null);
  const rows = useMemo(
    () => offeredProviderRows(allow, recommended),
    [allow, recommended],
  );

  const { choices, autoSelect, sharedOffered } = useMemo(
    () => providerChoices(rows, { itemByType, shared }, preferShared),
    [rows, itemByType, shared, preferShared],
  );
  const resolvedChoice: ProviderChoice | null = selected
    ? selected.id === shared?.id
      ? CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID
      : (typeByConnectionId.get(selected.id) ??
        (connected?.id === selected.id ? connected.type : null))
    : null;
  const selectedType =
    resolvedChoice && choices.some((c) => c.choice === resolvedChoice)
      ? resolvedChoice
      : null;

  const autoSelectTarget = autoSelectFirst ? autoSelect : undefined;

  useEffect(() => {
    if (!isSuccess || selectedType) return;
    if (autoSelectTarget) {
      onSelect(providerRef(autoSelectTarget));
    } else if (selected) {
      onSelect(null);
    }
  }, [isSuccess, selectedType, autoSelectTarget, selected, onSelect]);

  const pick = async (choice: ProviderChoice) => {
    if (choice === selectedType) return;
    if (selectedType && confirmSwitch && !(await confirmSwitch())) return;
    const item = choices.find((c) => c.choice === choice)?.item;
    if (item) onSelect(providerRef(item));
    else if (choice !== CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)
      setConnecting(choice);
  };

  if (isPending) return <Card className="h-[76px] animate-pulse" />;

  const options: RichSelectOption<ProviderChoice>[] = choices.map((c) => ({
    value: c.choice,
    title:
      c.choice === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID
        ? "CurveBender"
        : PROVIDERS[c.type].displayName,
    description: c.description,
    icon: <CardIcon provider={c.type} size="sm" />,
    triggerIcon: <CardIcon provider={c.type} />,
    badge:
      c.choice ===
      (sharedOffered ? CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID : recommended) ? (
        <Badge variant="muted">Recommended</Badge>
      ) : undefined,
    triggerBadge: c.item ? (
      <Badge variant="success">Connected</Badge>
    ) : undefined,
    trailing: c.item ? undefined : (
      <span className="shrink-0 text-sm text-muted-foreground">Connect</span>
    ),
    testId: `provider-option-${c.choice}`,
  }));

  return (
    <>
      <RichSelect
        options={options}
        value={selectedType}
        onSelect={(choice) => void pick(choice)}
        placeholder="Select a provider"
        ariaLabel="Provider"
        disabled={disabled}
        invalid={required && isSuccess && !selectedType && !autoSelectTarget}
        testId="provider-select"
      />
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
