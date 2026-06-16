import type { ConnectionTemplateView } from "api-server-api";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { ConnectionIcon } from "./connection-icon.js";

/**
 * The canonical connection-row family, shared across every surface that lists
 * connections — the create wizard, the sandbox settings page, and Settings →
 * Connections. Each surface supplies its own right-side action(s) via the
 * action slot and, where relevant, a select checkbox; the layout stays
 * identical so the three screens read as one component (the Figma "Connection"
 * states: unconnected → Connect, connected → Disconnect, +/- a select check).
 */

/** A catalog template row: icon, name, description, and a Connect action. */
export function ConnectionCatalogRow({
  template,
  onConnect,
}: {
  template: ConnectionTemplateView;
  onConnect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onConnect}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
    >
      <ConnectionIcon
        iconSlug={template.iconSlug}
        alt={template.name}
        size={18}
        className="shrink-0 text-foreground/80"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-foreground">
          {template.name}
        </p>
        {template.description && (
          <p className="text-[12px] text-muted-foreground">
            {template.description}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[13px] font-medium text-foreground">
        Connect
      </span>
    </button>
  );
}

/** Right-aligned text action used on connection rows (Connect / Disconnect). */
export function ConnectionAction({
  label,
  tone = "default",
  onClick,
  disabled,
}: {
  label: string;
  tone?: "default" | "danger";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "shrink-0 text-[13px] font-medium hover:underline disabled:opacity-50",
        tone === "danger" ? "text-danger" : "text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/**
 * An existing-connection row. Two modes:
 *  - **selectable** (wizard + sandbox settings): the whole card is a button
 *    that toggles whether the connection is granted to this sandbox; a check
 *    box on the left reflects the state.
 *  - **action** (Settings → Connections): not a toggle — the caller supplies
 *    explicit right-side action(s) (Connect / Disconnect / install) via the
 *    slot, since that surface manages connections globally.
 */
export function ConnectionRow({
  title,
  subtitle,
  iconSlug,
  connected,
  selectable = false,
  selected = false,
  onSelectedChange,
  testId,
  children,
}: {
  title: string;
  subtitle: string;
  iconSlug: string | undefined;
  connected: boolean;
  /** Render as a whole-card grant toggle (wizard + sandbox settings). */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (on: boolean) => void;
  /** Test hook for e2e (e.g. `connection-grant-<id>`); set on the card. */
  testId?: string;
  /** Right-side action(s) for the non-selectable (management) variant. */
  children?: ReactNode;
}) {
  const info = (
    <>
      <ConnectionIcon
        iconSlug={iconSlug}
        alt={title}
        size={18}
        className="shrink-0 text-foreground/80"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold text-foreground">{title}</p>
          {connected && (
            <span className="rounded-full bg-success-light px-2 py-0.5 text-[11px] font-medium text-success">
              Connected
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p>
      </div>
    </>
  );

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-4 py-3",
        selectable && selected ? "border-foreground" : "border-border",
      )}
    >
      {selectable ? (
        // The grant toggle covers everything except the action(s) on the
        // right, so most of the card is clickable without swallowing them.
        <button
          type="button"
          onClick={() => onSelectedChange?.(!selected)}
          role="checkbox"
          aria-checked={selected}
          className="-my-3 flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
        >
          <SelectIndicator selected={selected} />
          {info}
        </button>
      ) : (
        info
      )}
      {children}
    </div>
  );
}

/** Visual-only checkbox for the whole-card selectable row (the row's button
 *  owns the click, so this must not be interactive). */
function SelectIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-input",
      )}
    >
      {selected && <Check size={12} />}
    </span>
  );
}
