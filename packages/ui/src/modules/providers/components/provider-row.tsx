import type { HarnessFamily, ProviderKeyCheck } from "api-server-api";
import type { ReactNode } from "react";

import { HARNESS_ICONS, HARNESS_ORDER } from "@/components/harness-icons";
import { InlineList } from "@/components/inline-list";
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
 * UNIT_BOUNDARY_DESCRIPTION: one provider in Settings, a card of its own as on
 * an agent's page: a small icon, its name, its balance and spend pills, and the
 * words that say where it stands. The icon and name open it.
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
      {/* UNIT_BOUNDARY_DESCRIPTION: the whole row opens the provider, its padding included. Whatever has a title or an action of its own sits above the button: the spend pill keeps its dialog, and the balance and the status show their tooltips and pass a click on. */}
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
      />
      {balance && (
        <span onClick={onOpen} className="relative min-w-0" data-layer="raised">
          {balance}
        </span>
      )}
      {spend && (
        <span className="relative flex" data-layer="raised">
          {spend}
        </span>
      )}
      <span onClick={onOpen} className="relative flex" data-layer="raised">
        <ConnectionBadge
          connected={connected}
          degraded={degraded}
          keyCheck={keyCheck}
          checking={!!checking}
          reason={problemText}
        />
      </span>
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a provider row's small icon, its name, and the
 * harnesses it runs named in words under it: "All harnesses", "Bob only", or a
 * list.
 */
export function ProviderHead({
  type,
  templateId,
  name,
  harnesses,
}: {
  type: ProviderPresetType;
  templateId?: string | undefined;
  name: string;
  harnesses: readonly string[] | undefined;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <CardIcon provider={type} templateId={templateId} size="tile-sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {!!harnesses?.length && (
          <span className="truncate text-xs text-muted-foreground">
            {HARNESS_ORDER.every((h) => harnesses.includes(h)) ? (
              "All harnesses"
            ) : harnesses.length === 1 ? (
              `${harnessLabel(harnesses[0]!)} only`
            ) : (
              <InlineList items={harnesses.map(harnessLabel)} />
            )}
          </span>
        )}
      </span>
    </span>
  );
}

function harnessLabel(name: string): string {
  return HARNESS_ICONS[name as HarnessFamily]?.label ?? name;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the words that say where a provider row stands:
 * not connected, the key being checked, connected, or connected and in trouble
 * (rejected, unverified, or its template having an outage), with the reason in
 * its title. Colour only repeats what the words say.
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
  const [state, tone] = !connected
    ? (["Not connected", "text-muted-foreground"] as const)
    : checking
      ? (["Checking…", "text-muted-foreground"] as const)
      : keyCheck?.result === "refused"
        ? (["Key rejected", "text-danger"] as const)
        : degraded
          ? (["Outage", "text-danger"] as const)
          : keyCheck?.result === "unverified"
            ? (["Could not verify", "text-danger"] as const)
            : (["Connected", "text-green-700 dark:text-success"] as const);
  return (
    <span
      title={reason ?? undefined}
      data-testid={
        degraded && connected && !checking
          ? "provider-degraded-badge"
          : undefined
      }
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs font-medium",
        tone,
      )}
    >
      {checking && connected && <Spinner size={12} />}
      {state}
    </span>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return <div className="h-[49px] animate-pulse bg-muted/40" />;
};
