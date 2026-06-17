import type {
  AppConnectionView,
  ConnectionStatus,
  ConnectionTemplateView,
} from "api-server-api";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "./connection-icon.js";

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
      data-testid={`connection-template-${template.id}`}
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40"
    >
      <ConnectionIcon
        iconSlug={template.iconSlug}
        alt={template.name}
        size={16}
        className="mt-1 shrink-0 text-foreground/80"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium text-foreground">
          {template.name}
        </p>
        {template.description && (
          <p className="text-[14px] text-muted-foreground">
            {template.description}
          </p>
        )}
      </div>
      <span className="shrink-0 text-[14px] font-normal text-muted-foreground">
        Connect
      </span>
    </button>
  );
}

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
        "shrink-0 text-[14px] font-normal hover:underline disabled:opacity-50",
        tone === "danger" ? "text-danger" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function ConnectionRow({
  title,
  subtitle,
  iconSlug,
  status,
  selectable = false,
  selected = false,
  onSelectedChange,
  testId,
  children,
}: {
  title: string;
  subtitle: string;
  iconSlug: string | undefined;
  status?: AppConnectionView["status"];
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (on: boolean) => void;
  /** Test hook for e2e (e.g. `connection-grant-<id>`); set on the card. */
  testId?: string;
  children?: ReactNode;
}) {
  const info = (
    <>
      <ConnectionIcon
        iconSlug={iconSlug}
        alt={title}
        size={16}
        className="mt-1 shrink-0 text-foreground/80"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[16px] font-medium text-foreground">{title}</p>
          <StatusBadge status={status} />
        </div>
        <p className="truncate text-[14px] text-muted-foreground">{subtitle}</p>
      </div>
    </>
  );

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card p-4",
        selectable && selected ? "border-foreground" : "border-border",
      )}
    >
      {selectable ? (
        <button
          type="button"
          onClick={() => onSelectedChange?.(!selected)}
          role="checkbox"
          aria-checked={selected}
          className="-my-4 flex min-w-0 flex-1 items-start gap-3 py-4 text-left"
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

const STATUS_BADGE: Record<
  ConnectionStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  active: { label: "Connected", variant: "success" },
  pending: { label: "Authorizing…", variant: "muted" },
  expired: { label: "Expired", variant: "danger" },
  disconnected: { label: "Disconnected", variant: "muted" },
};

function StatusBadge({ status }: { status?: AppConnectionView["status"] }) {
  if (!status) return null;
  const { label, variant } = STATUS_BADGE[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function SelectIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-input",
      )}
    >
      {selected && <Check size={12} />}
    </span>
  );
}
