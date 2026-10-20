import { useEffect, useState } from "react";

import { Checkmark } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import { PROVIDERS, type ProviderPresetType } from "../../../types.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import { PROVIDER_ROWS } from "../../providers/lib/provider-rows.js";
import { useInstantStart } from "../context.js";

type Phase = "pick" | "connecting" | "connected";

interface Props {
  onClose: () => void;
}

export function ConfigureProviderModal({ onClose }: Props) {
  const ctx = useInstantStart();
  const [phase, setPhase] = useState<Phase>("pick");
  const [selected, setSelected] = useState<ProviderPresetType | null>(null);

  const handleConnect = (type: ProviderPresetType) => {
    setSelected(type);
    setPhase("connecting");
  };

  useEffect(() => {
    if (phase !== "connecting" || !selected) return;
    const t = setTimeout(() => {
      ctx?.setConnectedProviderType(selected);
      ctx?.setProviderAdded(true);
      setPhase("connected");
    }, 1200);
    return () => clearTimeout(t);
  }, [phase, selected, ctx]);

  useEffect(() => {
    if (phase !== "connected") return;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  const selectedName = selected ? PROVIDERS[selected].displayName : "";

  if (phase === "connecting") {
    return (
      <Modal widthClass="w-[480px]">
        <div className="flex flex-col items-center gap-4 px-8 py-12">
          <div className="size-10 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-sm font-medium text-foreground">
            Connecting to {selectedName}...
          </p>
        </div>
      </Modal>
    );
  }

  if (phase === "connected") {
    return (
      <Modal widthClass="w-[480px]">
        <div className="flex flex-col items-center gap-4 px-8 py-12">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary">
            <Checkmark size={20} className="text-primary-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {selectedName} connected
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your agent will now use {selectedName}. CurveBender budget paused.
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader
        title="Add your own provider"
        subtitle="Connect a provider API key to use your own models."
        onClose={onClose}
      />
      <DialogBody>
        <div className="flex flex-col gap-2">
          {PROVIDER_ROWS.map((row) => {
            const isConnected =
              ctx?.connectedProviderType === row.type;
            return (
              <Card
                key={row.type}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 transition-colors",
                  !isConnected && "hover:bg-muted/50",
                )}
              >
                <CardIcon provider={row.type} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {PROVIDERS[row.type].displayName}
                    </p>
                    {isConnected && (
                      <Badge variant="success">Connected</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {row.description}
                  </p>
                </div>
                {isConnected ? (
                  <Checkmark size={16} className="shrink-0 text-primary" />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect(row.type)}
                  >
                    Connect
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </DialogBody>
    </Modal>
  );
}
