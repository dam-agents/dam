import { BALANCE_PROVIDER_TYPES, harnessFits } from "api-server-api";
import { useState } from "react";

import { useStore } from "../../../store.js";
import type { ProviderPresetType } from "../../../types.js";
import { useDeleteConnection } from "../../connections/api/mutations.js";
import { useFeatures } from "../../features/api/queries.js";
import { useProviderStatus } from "../../provider-status/api/queries.js";
import { useHarnessCatalog } from "../../sessions/api/session-pair.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { PROVIDER_ROWS } from "../lib/provider-rows.js";
import { ProviderBalance } from "./provider-balance.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import type { ProviderItem } from "./provider-item.js";
import { ProviderRow } from "./provider-row.js";

export function ProviderSection({
  onConnected,
}: {
  onConnected?: (connectionId: string) => void;
} = {}) {
  const { itemByType, isPending } = useProviderItems();
  const { data: catalog, isPending: catalogPending } = useHarnessCatalog();
  const { data: flags, isPending: flagsPending } = useFeatures();
  const rows = PROVIDER_ROWS.filter(
    (row) =>
      row.type !== "platform" ||
      (flags?.["platform-provider"] &&
        (!onConnected || itemByType.has("platform"))),
  );
  const { data: status } = useProviderStatus();
  const degradedTemplate = (templateId: string | undefined) =>
    !!status &&
    (status.damSide !== null ||
      status.outages.some((o) => o.templateId === templateId));
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteConnection = useDeleteConnection();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);

  const disconnectProvider = async (item: ProviderItem) => {
    const ok = await showConfirm(
      "Agents using this provider can no longer reach its models.",
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
        {isPending || catalogPending || flagsPending
          ? rows.map((row) => <ProviderRow.Skeleton key={row.type} />)
          : rows.map((row) => {
              const item = itemByType.get(row.type);
              const builtIn = row.type === "platform";
              return (
                <ProviderRow
                  key={row.type}
                  type={row.type}
                  connected={!!item}
                  degraded={!!item && degradedTemplate(item.conn.templateId)}
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
                  connectedAction={onConnected && "Use"}
                  onOpen={
                    builtIn
                      ? item && onConnected && (() => onConnected(item.id))
                      : () =>
                          item && onConnected
                            ? onConnected(item.id)
                            : setDialog({ provider: row.type, item })
                  }
                />
              );
            })}
      </div>

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          item={dialog.item}
          onConnected={({ id }) => {
            setDialog(null);
            onConnected?.(id);
          }}
          onDisconnect={
            connectedItem && (() => void disconnectProvider(connectedItem))
          }
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
