import type { HarnessFamily, ProviderKeyCheck } from "api-server-api";
import { type ReactNode, useId } from "react";
import { match, P } from "ts-pattern";

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
  const id = useId();
  const problem =
    connected && !checking && keyCheck && keyCheck.result !== "ok"
      ? keyCheck
      : null;
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
          aria-describedby={`${id}-harnesses ${id}-status`}
          className="absolute inset-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      )}
      <ProviderHead
        type={type}
        templateId={templateId}
        name={name}
        harnesses={harnesses}
        id={id}
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
          id={`${id}-status`}
          name={name}
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
  id,
}: {
  type: ProviderPresetType;
  templateId?: string | undefined;
  name: string;
  harnesses: readonly string[] | undefined;
  id?: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <CardIcon provider={type} templateId={templateId} size="tile-sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {!!harnesses?.length && (
          <span
            id={id && `${id}-harnesses`}
            className="text-xs text-muted-foreground"
          >
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
 * its title. Colour only repeats what the words say, and a screen reader hears
 * the result of a check as it lands, with the provider's name.
 */
function ConnectionBadge({
  id,
  name,
  connected,
  degraded,
  keyCheck,
  checking,
  reason,
}: {
  id: string;
  name: string;
  connected: boolean;
  degraded: boolean;
  keyCheck: ProviderKeyCheck | null | undefined;
  checking: boolean;
  reason: string | null;
}) {
  const [state, tone] = match({ connected, checking, degraded, keyCheck })
    .with({ connected: false }, () => [
      "Not connected",
      "text-muted-foreground",
    ])
    .with({ checking: true }, () => ["Checking…", "text-muted-foreground"])
    .with({ keyCheck: { result: "refused" } }, () => [
      "Key rejected",
      "text-danger",
    ])
    .with({ degraded: true }, () => ["Outage", "text-danger"])
    .with({ keyCheck: { result: "unverified" } }, () => [
      "Could not verify",
      "text-danger",
    ])
    .with({ keyCheck: P.union({ result: "ok" }, P.nullish) }, () => [
      "Connected",
      "text-green-700 dark:text-success",
    ])
    .exhaustive();
  return (
    <span
      id={id}
      role="status"
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
      <span className="sr-only">{name}: </span>
      {state}
    </span>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return <div className="h-[49px] animate-pulse bg-muted/40" />;
};
