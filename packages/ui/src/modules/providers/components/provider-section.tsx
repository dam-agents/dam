import { useState } from "react";

import { Modal } from "../../../components/modal.js";
import type { ProviderPresetType } from "../../../types.js";
import { useInstantStart } from "../../instant-start/context.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { PROVIDER_ROWS } from "../lib/provider-rows.js";
import { IbmLitellmForm } from "./ibm-litellm/form.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { type ProviderItem, providerRef } from "./provider-item.js";
import { ProviderRow } from "./provider-row.js";
import { useProviderActions } from "./use-provider-actions.js";

export function ProviderSection() {
  const { itemByType, isPending } = useProviderItems();
  const instantStart = useInstantStart();
  const providerActions = useProviderActions();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);
  const [instantForm, setInstantForm] = useState<ProviderPresetType | null>(
    null,
  );

  const isConnected = (type: ProviderPresetType) =>
    itemByType.has(type) || instantStart?.connectedProviderType === type;

  const handleConnect = (type: ProviderPresetType) => {
    if (instantStart) {
      if (type === "ibm-litellm") {
        setInstantForm(type);
        return;
      }
      instantStart.setConnectedProviderType(type);
      instantStart.setActiveProvider(type);
      instantStart.setProviderAdded(true);
      return;
    }
    setDialog({ provider: type });
  };

  const handleInstantFormSave = async () => {
    if (!instantStart || !instantForm) return;
    instantStart.setConnectedProviderType(instantForm);
    instantStart.setActiveProvider(instantForm);
    instantStart.setProviderAdded(true);
    setInstantForm(null);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        {isPending
          ? PROVIDER_ROWS.map((row) => <ProviderRow.Skeleton key={row.type} />)
          : PROVIDER_ROWS.map((row) => {
              const item = itemByType.get(row.type);
              const connected = isConnected(row.type);
              return (
                <ProviderRow
                  key={row.type}
                  type={row.type}
                  description={row.description}
                  connected={connected}
                  onConnect={() => handleConnect(row.type)}
                  onEditKey={() =>
                    item
                      ? setDialog({ provider: row.type, item })
                      : handleConnect(row.type)
                  }
                  onRemoveKey={() => {
                    if (
                      instantStart &&
                      instantStart.connectedProviderType === row.type
                    ) {
                      instantStart.setConnectedProviderType(null);
                      instantStart.setActiveProvider("curvebender");
                      instantStart.setProviderAdded(false);
                      return;
                    }
                    if (item) void providerActions.remove(providerRef(item));
                  }}
                />
              );
            })}
      </div>

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          item={dialog.item}
          onConnected={() => {
            if (instantStart && dialog) {
              instantStart.setConnectedProviderType(dialog.provider);
              instantStart.setActiveProvider(dialog.provider);
              instantStart.setProviderAdded(true);
            }
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {instantForm === "ibm-litellm" && (
        <Modal widthClass="w-[505px]">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IbmLitellmForm
              variant="wizard"
              onSave={handleInstantFormSave}
              onCancel={() => setInstantForm(null)}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
