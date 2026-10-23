import type { HarnessFamily, ProviderKeyCheck } from "api-server-api";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { CardButton } from "@/components/ui/card-button";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import type { ProviderPresetType } from "../../../types.js";
import { providerName } from "../lib/provider-rows.js";
import { CardIcon } from "./card-icon.js";

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
  const rejected = connected && keyCheck?.result === "refused";
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
            keyCheck={keyCheck}
            checking={!!checking}
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
          <div className="min-w-0 text-right">{balance}</div>
        </div>
      </div>
    </>
  );
  const layout = "flex w-full items-start gap-3 p-4";
  const label = connected
    ? `${connectedAction} ${name}${rejected ? ", key rejected" : ""}`
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one pill that says where a provider row
 * stands: whether it is configured, and, once it is, whether its key is being
 * verified, rejected by the provider, or working. A provider that could not
 * answer or whose template is having an outage keeps a yellow pill, with the
 * reason in its tooltip, since neither says the key is bad.
 */
function ConnectionBadge({
  connected,
  degraded,
  keyCheck,
  checking,
}: {
  connected: boolean;
  degraded: boolean;
  keyCheck: ProviderKeyCheck | null | undefined;
  checking: boolean;
}) {
  const pill = "ml-auto shrink-0 gap-1.5";
  if (!connected)
    return (
      <Badge variant="muted" className={pill}>
        Not configured
      </Badge>
    );
  if (checking)
    return (
      <Badge variant="warning" className={pill}>
        <Spinner size={12} className="shrink-0" />
        Configured · Verifying
      </Badge>
    );
  if (keyCheck?.result === "refused")
    return (
      <Badge
        variant="danger"
        className={pill}
        title={`Key rejected on ${formatTimestamp(keyCheck.checkedAt)} (${keyCheck.detail})`}
      >
        Configured · Key rejected
      </Badge>
    );
  if (degraded)
    return (
      <Badge
        variant="warning"
        className={pill}
        data-testid="provider-degraded-badge"
      >
        Configured · Degraded
      </Badge>
    );
  if (keyCheck?.result === "unverified")
    return (
      <Badge
        variant="warning"
        className={pill}
        title={`Could not verify the key on ${formatTimestamp(keyCheck.checkedAt)}: ${keyCheck.detail}`}
      >
        Configured · Unverified
      </Badge>
    );
  return (
    <Badge variant="success" className={pill}>
      Configured · Connected
    </Badge>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return <Card className="h-[92px] animate-pulse" />;
};
