import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import { PROVIDERS, type ProviderPresetType } from "../../../types.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import { PROVIDER_ROWS } from "../../providers/lib/provider-rows.js";
import { useInstantStart } from "../context.js";

interface Props {
  onClose: () => void;
}

export function ConfigureProviderModal({ onClose }: Props) {
  const ctx = useInstantStart();
  const [selected, setSelected] = useState<ProviderPresetType | null>(null);

  const handleConnect = (type: ProviderPresetType) => {
    setSelected(type);
    ctx?.setProviderAdded(true);
    onClose();
  };

  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader
        title="Add your own provider"
        subtitle="Connect a provider API key to use your own models."
        onClose={onClose}
      />
      <DialogBody>
        <div className="flex flex-col gap-2">
          {PROVIDER_ROWS.map((row) => (
            <Card
              key={row.type}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <CardIcon provider={row.type} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {PROVIDERS[row.type].displayName}
                </p>
                <p className="text-sm text-muted-foreground">{row.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleConnect(row.type)}
              >
                Connect
              </Button>
            </Card>
          ))}
        </div>
      </DialogBody>
    </Modal>
  );
}
