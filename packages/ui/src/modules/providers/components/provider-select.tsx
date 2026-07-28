import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { RichSelect, type RichSelectOption } from "@/components/ui/rich-select";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { offeredProviderRows } from "../lib/provider-rows.js";
import { CardIcon } from "./card-icon.js";
import { ConnectedBadge } from "./connected-badge.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { type ProviderRef, providerRef } from "./provider-item.js";

interface Props {
  selected: ProviderRef | null;
  onSelect: (ref: ProviderRef) => void;
  /** Gate for switching away from an already-selected provider (Configure's
   *  warning). Resolve false to keep the current one. Not consulted on first
   *  selection or when the pick goes through the connect dialog. */
  confirmSwitch?: () => Promise<boolean>;
  autoSelectFirst?: boolean;
  disabled?: boolean;
  /** Restrict the offered providers. Omit to offer all of them. */
  allow?: readonly ProviderPresetType[];
  /** Offered first and badged; `autoSelectFirst` therefore prefers it. */
  recommended?: ProviderPresetType;
}

/** Single-select for the sandbox's provider — a sandbox uses exactly one, so
 *  picking another replaces it. Providers without a key show "Connect" and
 *  open the key dialog; a saved key selects that provider directly. */
export function ProviderSelect({
  selected,
  onSelect,
  confirmSwitch,
  autoSelectFirst = false,
  disabled = false,
  allow,
  recommended,
}: Props) {
  const { itemByType, isPending } = useProviderItems();
  const [connecting, setConnecting] = useState<ProviderPresetType | null>(null);
  const rows = useMemo(
    () => offeredProviderRows(allow, recommended),
    [allow, recommended],
  );

  const selectedType = useMemo(() => {
    if (!selected) return null;
    for (const [type, item] of itemByType)
      if (item.id === selected.id) return type;
    return null;
  }, [itemByType, selected]);

  // Only acts while empty so a just-connected provider isn't nulled out during
  // the list refetch.
  useEffect(() => {
    if (!autoSelectFirst || selected) return;
    const first = rows.map((r) => itemByType.get(r.type)).find(Boolean);
    if (first) onSelect(providerRef(first));
  }, [autoSelectFirst, selected, itemByType, rows, onSelect]);

  const pick = async (type: ProviderPresetType) => {
    const item = itemByType.get(type);
    if (!item) {
      setConnecting(type);
      return;
    }
    if (type === selectedType) return;
    if (selected && confirmSwitch && !(await confirmSwitch())) return;
    onSelect(providerRef(item));
  };

  if (isPending)
    return (
      <div className="h-[76px] rounded-lg border border-border bg-card anim-pulse" />
    );

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
    triggerBadge: itemByType.has(row.type) ? <ConnectedBadge /> : undefined,
    trailing: itemByType.has(row.type) ? undefined : (
      <span className="shrink-0 text-[13px] text-muted-foreground">
        Connect
      </span>
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
        disabled={disabled}
        testId="provider-select"
      />
      {connecting && (
        <ProviderConnectDialog
          provider={connecting}
          onConnected={(ref) => {
            onSelect(ref);
            setConnecting(null);
          }}
          onClose={() => setConnecting(null)}
        />
      )}
    </>
  );
}
