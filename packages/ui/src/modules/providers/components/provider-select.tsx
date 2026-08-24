import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RichSelect, type RichSelectOption } from "@/components/ui/rich-select";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { offeredProviderRows } from "../lib/provider-rows.js";
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
}: Props) {
  const { itemByType, typeByConnectionId, isPending } = useProviderItems();
  const [connecting, setConnecting] = useState<ProviderPresetType | null>(null);
  const [connected, setConnected] = useState<{
    id: string;
    type: ProviderPresetType;
  } | null>(null);
  const rows = useMemo(
    () => offeredProviderRows(allow, recommended),
    [allow, recommended],
  );

  const selectedType = selected
    ? (typeByConnectionId.get(selected.id) ??
      (connected?.id === selected.id ? connected.type : null))
    : null;

  const firstConnected = useMemo(
    () => rows.map((r) => itemByType.get(r.type)).find(Boolean),
    [rows, itemByType],
  );

  useEffect(() => {
    if (isPending || selectedType) return;
    if (autoSelectFirst && firstConnected) {
      onSelect(providerRef(firstConnected));
    } else if (selected) {
      onSelect(null);
    }
  }, [
    isPending,
    selectedType,
    autoSelectFirst,
    firstConnected,
    selected,
    onSelect,
  ]);

  const pick = async (type: ProviderPresetType) => {
    if (type === selectedType) return;
    if (selectedType && confirmSwitch && !(await confirmSwitch())) return;
    const item = itemByType.get(type);
    if (!item) {
      setConnecting(type);
      return;
    }
    onSelect(providerRef(item));
  };

  if (isPending) return <Card className="h-[76px] animate-pulse" />;

  const options: RichSelectOption<ProviderPresetType>[] = rows.map((row) => ({
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
  }));

  return (
    <>
      <RichSelect
        options={options}
        value={selectedType}
        onSelect={(type) => void pick(type)}
        placeholder="Select a provider"
        ariaLabel="Provider"
        disabled={disabled}
        invalid={
          required && !selectedType && !(autoSelectFirst && firstConnected)
        }
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
