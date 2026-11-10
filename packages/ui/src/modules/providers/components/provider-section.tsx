import { useState } from "react";

import { useStore } from "../../../store.js";
import type { ProviderPresetType } from "../../../types.js";
import { useDeleteConnection } from "../../connections/api/mutations.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import {
  CURVE_BENDER_DESCRIPTION,
  PROVIDER_ROWS,
} from "../lib/provider-rows.js";
import { CurveBenderInfoDialog } from "./curve-bender-info-dialog.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import type { ProviderItem } from "./provider-item.js";
import { ProviderRow } from "./provider-row.js";

export function ProviderSection() {
  const { itemByType, shared, isPending } = useProviderItems();
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteConnection = useDeleteConnection();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);
  const [sharedInfoOpen, setSharedInfoOpen] = useState(false);

  const removeProvider = async (item: ProviderItem) => {
    const ok = await showConfirm(
      "Are you sure you want to remove this provider? Any agent currently using this provider will no longer work as expected.",
      "Remove Provider?",
      { kind: "destructive", confirmLabel: "Remove provider" },
    );
    if (!ok) return;
    deleteConnection.mutate({ id: item.id });
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        {isPending
          ? PROVIDER_ROWS.map((row) => <ProviderRow.Skeleton key={row.type} />)
          : PROVIDER_ROWS.flatMap((row) => {
              const item = itemByType.get(row.type);
              const sharedRow =
                row.type === "curve-bender" && shared ? (
                  <ProviderRow.Info
                    key="curve-bender-deployment"
                    type="curve-bender"
                    name="CurveBender"
                    description={CURVE_BENDER_DESCRIPTION}
                    onOpen={() => setSharedInfoOpen(true)}
                  />
                ) : null;
              if (sharedRow && !item) return [sharedRow];
              const ownRow = (
                <ProviderRow
                  key={row.type}
                  type={row.type}
                  description={row.description}
                  connected={!!item}
                  onConnect={() => setDialog({ provider: row.type })}
                  onEditKey={() =>
                    item && setDialog({ provider: row.type, item })
                  }
                  onRemoveKey={() => item && void removeProvider(item)}
                />
              );
              return sharedRow ? [sharedRow, ownRow] : [ownRow];
            })}
      </div>

      {sharedInfoOpen && (
        <CurveBenderInfoDialog onClose={() => setSharedInfoOpen(false)} />
      )}
      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          item={dialog.item}
          onConnected={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
