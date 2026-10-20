import { useEffect, useState } from "react";

import { Checkmark, ChevronDown } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import { PROVIDERS, type ProviderPresetType } from "../../../types.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import { PROVIDER_ROWS } from "../../providers/lib/provider-rows.js";
import { useInstantStart } from "../context.js";

type Phase = "pick" | "connecting" | "connected";

interface ProviderOption {
  type: ProviderPresetType | "curvebender";
  title: string;
  description: string;
  icon: React.ReactNode;
}

const CURVEBENDER_OPTION: ProviderOption = {
  type: "curvebender",
  title: "CurveBender",
  description: "Free sponsored budget — no API key needed.",
  icon: (
    <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
      <img src="/curvebender-logo.svg" alt="CurveBender" className="size-5" />
    </div>
  ),
};

interface Props {
  onClose: () => void;
}

export function ConfigureProviderModal({ onClose }: Props) {
  const ctx = useInstantStart();
  const [phase, setPhase] = useState<Phase>("pick");
  const [selected, setSelected] = useState<ProviderPresetType | null>(null);

  const currentProvider = ctx?.connectedProviderType ?? null;
  const isCurveBender = !currentProvider;

  const allOptions: ProviderOption[] = [
    CURVEBENDER_OPTION,
    ...PROVIDER_ROWS.map((row) => ({
      type: row.type as ProviderPresetType,
      title: PROVIDERS[row.type].displayName,
      description: row.description,
      icon: <CardIcon provider={row.type} size="sm" />,
    })),
  ];

  const handleSelect = (opt: ProviderOption) => {
    if (opt.type === "curvebender") {
      ctx?.setConnectedProviderType(null);
      ctx?.setProviderAdded(false);
      onClose();
      return;
    }
    const providerType = opt.type as ProviderPresetType;
    if (providerType === currentProvider) return;
    setSelected(providerType);
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
      <Modal widthClass="w-[505px]">
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
      <Modal widthClass="w-[505px]">
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

  const activeType: string = currentProvider ?? "curvebender";

  return (
    <Modal widthClass="w-[505px]">
      <DialogHeader
        title="Configure provider"
        subtitle="Choose which provider this agent uses."
        onClose={onClose}
      />
      <DialogBody>
        {/* Trigger-style card showing current selection */}
        <button
          type="button"
          className={cn(
            CARD_SURFACE,
            "group flex min-h-[76px] w-full items-center gap-3.5 p-4 text-left border-foreground",
          )}
        >
          {isCurveBender ? (
            CURVEBENDER_OPTION.icon
          ) : (
            <CardIcon provider={currentProvider} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <p className="truncate text-base font-medium text-foreground">
                {isCurveBender
                  ? "CurveBender"
                  : PROVIDERS[currentProvider].displayName}
              </p>
              <Badge variant="success">Active</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {isCurveBender
                ? "Free sponsored budget — no API key needed."
                : PROVIDER_ROWS.find((r) => r.type === currentProvider)
                    ?.description ?? ""}
            </p>
          </div>
          <ChevronDown
            size={18}
            className="shrink-0 text-muted-foreground rotate-180"
          />
        </button>

        {/* Dropdown options — rendered open */}
        <div className="mt-2 rounded-lg border border-border bg-popover p-1.5 shadow-md">
          {allOptions.map((opt) => {
            const isActive = opt.type === activeType;
            return (
              <button
                key={opt.type}
                type="button"
                onClick={() => handleSelect(opt)}
                className={cn(
                  "flex h-auto w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                  isActive && "bg-muted/50",
                )}
              >
                {opt.icon}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {opt.title}
                    </p>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
                {isActive ? (
                  <Checkmark size={16} className="shrink-0 text-foreground" />
                ) : (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {opt.type === "curvebender" ? "Free" : "Connect"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DialogBody>
    </Modal>
  );
}
