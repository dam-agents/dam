import { BALANCE_PROVIDER_TYPES, harnessFits } from "api-server-api";
import { useState } from "react";

import { useStore } from "../../../store.js";
import type { ProviderPresetType } from "../../../types.js";
import { useDeleteConnection } from "../../connections/api/mutations.js";
import { useHarnessCatalog } from "../../sessions/api/session-pair.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { PROVIDER_ROWS } from "../lib/provider-rows.js";
import { ProviderBalance } from "./provider-balance.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import type { ProviderItem } from "./provider-item.js";
import { ProviderRow } from "./provider-row.js";

export function ProviderSection() {
  const { itemByType, isPending } = useProviderItems();
  const { data: catalog, isPending: catalogPending } = useHarnessCatalog();
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteConnection = useDeleteConnection();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);

  const disconnectProvider = async (item: ProviderItem) => {
    const ok = await showConfirm(
      "Are you sure you want to disconnect this provider? Any agent currently using this provider will no longer work as expected.",
      "Disconnect provider?",
      { kind: "destructive", confirmLabel: "Disconnect provider" },
    );
    if (!ok) return;
    deleteConnection.mutate({ id: item.id });
    setDialog(null);
  };

  const connectedItem = dialog?.item;

  return (
    <>
      <div className="flex flex-col gap-3">
        {isPending || catalogPending
          ? PROVIDER_ROWS.map((row) => <ProviderRow.Skeleton key={row.type} />)
          : PROVIDER_ROWS.map((row) => {
              const item = itemByType.get(row.type);
              return (
                <ProviderRow
                  key={row.type}
                  type={row.type}
                  connected={!!item}
                  harnesses={catalog?.harnesses
                    .filter((h) =>
                      harnessFits(
                        catalog,
                        h.name,
                        row.type,
                        item?.conn.templateId,
                      ),
                    )
                    .map((h) => h.name)}
                  balance={
                    item &&
                    BALANCE_PROVIDER_TYPES.has(row.type) && (
                      <ProviderBalance connectionId={item.id} />
                    )
                  }
                  onOpen={() => setDialog({ provider: row.type, item })}
                />
              );
            })}
      </div>

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          item={dialog.item}
          onConnected={() => setDialog(null)}
          onDisconnect={
            connectedItem && (() => void disconnectProvider(connectedItem))
          }
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
