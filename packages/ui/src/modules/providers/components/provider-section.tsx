import { useState } from "react";

import type { ProviderPresetType } from "../../../types.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { PROVIDER_ROWS } from "../lib/provider-rows.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { type ProviderItem, providerRef } from "./provider-item.js";
import { ProviderRow } from "./provider-row.js";
import { useProviderActions } from "./use-provider-actions.js";

/** Settings → Providers: the global credential store. Sandboxes pick one of
 *  these via {@link ProviderSelect}; this page only manages the keys. */
export function ProviderSection() {
  const { itemByType, isPending } = useProviderItems();
  const providerActions = useProviderActions();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);

  return (
    <>
      <div className="flex flex-col gap-3">
        {isPending
          ? PROVIDER_ROWS.map((row) => <ProviderRow.Skeleton key={row.type} />)
          : PROVIDER_ROWS.map((row) => {
              const item = itemByType.get(row.type);
              return (
                <ProviderRow
                  key={row.type}
                  type={row.type}
                  description={row.description}
                  connected={!!item}
                  onConnect={() => setDialog({ provider: row.type })}
                  onEditKey={() =>
                    item && setDialog({ provider: row.type, item })
                  }
                  onRemoveKey={() =>
                    item && void providerActions.remove(providerRef(item))
                  }
                />
              );
            })}
      </div>

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
