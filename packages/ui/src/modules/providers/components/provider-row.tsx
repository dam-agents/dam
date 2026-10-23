import type { HarnessFamily, ProviderKeyCheck } from "api-server-api";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { CardButton } from "@/components/ui/card-button";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";
import { providerName } from "../lib/provider-rows.js";
import { CardIcon } from "./card-icon.js";
import { ProviderKeyStatus } from "./provider-key-status.js";

interface Props {
  type: ProviderPresetType;
  templateId?: string;
  name?: string;
  harnesses?: readonly HarnessFamily[];
  connected: boolean;
  degraded?: boolean;
  keyCheck?: ProviderKeyCheck | null;
  checking?: boolean;
  balance?: ReactNode;
  onOpen?: () => void;
  connectedAction?: string;
  footer?: ReactNode;
}

export function ProviderRow({
  type,
  templateId,
  name: givenName,
  harnesses,
  connected,
  degraded = false,
  keyCheck,
  checking,
  balance,
  onOpen,
  connectedAction = "Edit",
  footer,
}: Props) {
  const name = givenName ?? providerName(type);
  const refused = connected && keyCheck?.result === "refused";
  const keyStatus =
    connected && keyCheck !== undefined ? (
      <ProviderKeyStatus check={keyCheck} checking={checking} />
    ) : null;
  const keyStatusBesideHarnesses =
    connected &&
    keyCheck !== undefined &&
    (checking || keyCheck?.result === "ok");
  const body = (
    <>
      <CardIcon provider={type} templateId={templateId} />
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-2">
          <p
            className="truncate text-base font-medium text-foreground"
            title={name}
          >
            {name}
          </p>
          <ConnectionBadge
            connected={connected}
            degraded={degraded}
            refused={refused}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">Supports:</span>
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
          <div className="flex min-w-0 items-center justify-end gap-3 text-right">
            {keyStatusBesideHarnesses && keyStatus}
            {balance}
          </div>
        </div>
        {keyStatus && !keyStatusBesideHarnesses && (
          <div className="mt-2">{keyStatus}</div>
        )}
      </div>
    </>
  );
  const layout = "flex w-full items-start gap-3 p-4";
  const label = connected
    ? `${connectedAction} ${name}${refused ? ", key refused" : ""}`
    : `Connect ${name}`;

  if (footer) {
    return (
      <Card className="overflow-hidden">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={label}
            className={cn(layout, ROW_HEAD_BUTTON)}
          >
            {body}
          </button>
        ) : (
          <div className={layout}>{body}</div>
        )}
        <div className="mx-4 border-t border-border py-3">{footer}</div>
      </Card>
    );
  }
  return onOpen ? (
    <CardButton onClick={onOpen} aria-label={label} className={layout}>
      {body}
    </CardButton>
  ) : (
    <div className={cn(CARD_SURFACE, layout)}>{body}</div>
  );
}

const ROW_HEAD_BUTTON = `text-left ${CARD_HOVER} focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`;

function ConnectionBadge({
  connected,
  degraded,
  refused,
}: {
  connected: boolean;
  degraded: boolean;
  refused: boolean;
}) {
  if (!connected)
    return (
      <Badge variant="muted" className="ml-auto shrink-0">
        Not connected
      </Badge>
    );
  if (refused)
    return (
      <Badge variant="danger" className="ml-auto shrink-0">
        Key refused
      </Badge>
    );
  return degraded ? (
    <Badge
      variant="warning"
      className="ml-auto shrink-0"
      data-testid="provider-degraded-badge"
    >
      Degraded
    </Badge>
  ) : (
    <Badge variant="success" className="ml-auto shrink-0">
      Connected
    </Badge>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return <Card className="h-[92px] animate-pulse" />;
};
