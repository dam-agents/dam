import type { HarnessFamily, ProviderKeyCheck } from "api-server-api";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CARD_SURFACE } from "@/components/ui/card";
import { CardButton } from "@/components/ui/card-button";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";
import { providerName } from "../lib/provider-rows.js";
import { CardIcon } from "./card-icon.js";
import { ProviderKeyStatus } from "./provider-key-status.js";

interface Props {
  type: ProviderPresetType;
  harnesses?: readonly HarnessFamily[];
  connected: boolean;
  keyCheck?: ProviderKeyCheck | null;
  checking?: boolean;
  balance?: ReactNode;
  onOpen?: () => void;
  connectedAction?: string;
}

export function ProviderRow({
  type,
  harnesses,
  connected,
  keyCheck,
  checking,
  balance,
  onOpen,
  connectedAction = "Edit",
}: Props) {
  const name = providerName(type);
  const refused = connected && !checking && keyCheck?.result === "refused";
  const body = (
    <>
      <CardIcon provider={type} />
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-2">
          <p
            className="truncate text-base font-medium text-foreground"
            title={name}
          >
            {name}
          </p>
          <Badge
            variant={refused ? "danger" : connected ? "success" : "muted"}
            className="ml-auto shrink-0"
          >
            {refused
              ? "Key refused"
              : connected
                ? "Connected"
                : "Not connected"}
          </Badge>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">supports:</span>
            {harnesses?.length ? (
              <HarnessIcons
                harnesses={harnesses}
                size="sm"
                focusable={!onOpen}
                className="text-muted-foreground opacity-70"
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                {harnesses ? "None" : "Compatibility unavailable"}
              </span>
            )}
          </div>
          <div className="min-w-0 text-right">{balance}</div>
        </div>
        {connected && keyCheck !== undefined && (
          <div className="mt-2">
            <ProviderKeyStatus check={keyCheck} checking={checking} />
          </div>
        )}
      </div>
    </>
  );
  const layout = "flex w-full items-center gap-3 p-4";

  return onOpen ? (
    <CardButton
      onClick={onOpen}
      aria-label={connected ? `${connectedAction} ${name}` : `Connect ${name}`}
      className={layout}
    >
      {body}
    </CardButton>
  ) : (
    <div className={cn(CARD_SURFACE, layout)}>{body}</div>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return <Card className="h-[92px] animate-pulse" />;
};
