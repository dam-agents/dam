import { CheckmarkFilled, ErrorFilled, Misuse } from "@carbon/icons-react";
import type { HarnessFamily, ProviderKeyCheck } from "api-server-api";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
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
        "relative flex items-center gap-3 px-4 py-2.5",
        onOpen && "hover:bg-muted/50",
      )}
    >
      {/* UNIT_BOUNDARY_DESCRIPTION: the whole row opens the provider, its padding included; the spend pill sits above the button and keeps its own dialog, and the harness icons sit above it for their tooltips and open the provider too. */}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={label}
          className="absolute inset-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      )}
      <ProviderHead
        type={type}
        templateId={templateId}
        name={name}
        harnesses={harnesses}
        onOpen={onOpen}
      />
      {balance}
      {spend && <span className="relative flex">{spend}</span>}
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
 * UNIT_BOUNDARY_DESCRIPTION: a provider row's small icon, its name, and the
 * harnesses it runs as small muted icons after the name, each named for a
 * screen reader and saying "Supports <harness>" on hover.
 */
export function ProviderHead({
  type,
  templateId,
  name,
  harnesses,
  onOpen,
}: {
  type: ProviderPresetType;
  templateId?: string | undefined;
  name: string;
  harnesses: readonly string[] | undefined;
  onOpen?: (() => void) | undefined;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <CardIcon provider={type} templateId={templateId} size="tile-sm" />
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {name}
      </span>
      {harnesses && (
        <span
          onClick={onOpen}
          className={cn("relative flex shrink-0", onOpen && "cursor-pointer")}
        >
          <HarnessIcons
            harnesses={harnesses}
            size="xs"
            tooltip={(harness) => `Supports ${harness}`}
            className="gap-1 text-muted-foreground opacity-70"
          />
        </span>
      )}
    </span>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one icon that says where a provider row
 * stands, its state as its accessible name: not configured, the key being
 * verified, working, or, configured and in trouble (rejected, unverified, or
 * its template having an outage), with the reason in its title.
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
  const [state, Icon, tone] = !connected
    ? (["Not configured", ErrorFilled, "text-muted-foreground"] as const)
    : checking
      ? (["Configured · Verifying", null, ""] as const)
      : keyCheck?.result === "refused"
        ? (["Configured · Key rejected", Misuse, "text-danger"] as const)
        : degraded
          ? (["Configured · Degraded", Misuse, "text-danger"] as const)
          : keyCheck?.result === "unverified"
            ? (["Configured · Unverified", Misuse, "text-danger"] as const)
            : ([
                "Configured · Connected",
                CheckmarkFilled,
                "text-success",
              ] as const);
  return (
    <span
      role="img"
      aria-label={state}
      title={reason ?? state}
      data-testid={
        degraded && connected && !checking
          ? "provider-degraded-badge"
          : undefined
      }
      className={cn("flex shrink-0", tone)}
    >
      {Icon ? (
        <Icon size={16} aria-hidden />
      ) : (
        <Spinner size={14} className="text-muted-foreground" />
      )}
    </span>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return <div className="h-[49px] animate-pulse bg-muted/40" />;
};
