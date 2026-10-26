import type { HarnessFamily, ProviderKeyCheck } from "api-server-api";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
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
  spend?: ReactNode;
  onOpen?: () => void;
  connectedAction?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one provider in Settings, on a single line as on
 * an agent's page: a small icon, its name, its balance and spend pills, and the
 * badge that says where it stands. The icon and name open it.
 */
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
  spend,
  onOpen,
  connectedAction = "Edit",
}: Props) {
  const name = givenName ?? providerName(type);
  const problem =
    connected && keyCheck && keyCheck.result !== "ok" ? keyCheck : null;
  const problemText = problem
    ? `${
        problem.result === "refused"
          ? "Key rejected"
          : "Could not verify the key"
      } on ${formatTimestamp(problem.checkedAt)} (${problem.detail})`
    : null;
  const label = connected
    ? `${connectedAction} ${name}${problemText ? `, ${problemText}` : ""}`
    : `Connect ${name}`;
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5",
        onOpen && "hover:bg-muted/50",
      )}
    >
      <ProviderHead
        type={type}
        templateId={templateId}
        name={name}
        harnesses={harnesses}
        onOpen={onOpen}
        label={label}
      />
      {balance}
      {spend}
      <ConnectionBadge
        connected={connected}
        degraded={degraded}
        keyCheck={keyCheck}
        checking={!!checking}
        reason={problemText}
      />
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a provider row's small icon and name, with the
 * harnesses it runs in their tooltip; a button that opens the provider where
 * the row offers that, else a focusable span so the tooltip still opens.
 */
export function ProviderHead({
  type,
  templateId,
  name,
  harnesses,
  onOpen,
  label,
}: {
  type: ProviderPresetType;
  templateId?: string | undefined;
  name: string;
  harnesses: readonly string[] | undefined;
  onOpen?: (() => void) | undefined;
  label?: string;
}) {
  const head = (
    <>
      <CardIcon provider={type} templateId={templateId} size="tile-sm" />
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {name}
      </span>
    </>
  );
  const className =
    "flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Tooltip content={<HarnessSupport harnesses={harnesses} />}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={label}
          className={className}
        >
          {head}
        </button>
      ) : (
        <span tabIndex={0} className={className}>
          {head}
        </span>
      )}
    </Tooltip>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: which harnesses a provider runs, as the tooltip of its row; a missing catalog says so rather than inventing compatibility. */
export function HarnessSupport({
  harnesses,
}: {
  harnesses: readonly string[] | undefined;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      Supports:
      {harnesses?.length ? (
        <HarnessIcons harnesses={harnesses} size="sm" className="flex-wrap" />
      ) : (
        <span>{harnesses ? "None" : "Compatibility unavailable"}</span>
      )}
    </span>
  );
}

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
  reason,
}: {
  connected: boolean;
  degraded: boolean;
  keyCheck: ProviderKeyCheck | null | undefined;
  checking: boolean;
  reason: string | null;
}) {
  const pill = "shrink-0 gap-1.5";
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
      <Badge variant="danger" className={pill} title={reason ?? undefined}>
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
      <Badge variant="warning" className={pill} title={reason ?? undefined}>
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
  return <div className="h-[49px] animate-pulse bg-muted/40" />;
};
