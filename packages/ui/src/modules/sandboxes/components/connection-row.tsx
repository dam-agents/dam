import type { ConnectionTemplateView } from "api-server-api";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";

export function CatalogConnectionRow({
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

export function MyConnectionRow({
  title,
  subtitle,
  iconSlug,
  active,
  selected,
  onToggle,
  onDisconnect,
  testId,
}: {
  title: string;
  subtitle: string;
  iconSlug: string | undefined;
  active: boolean;
  selected: boolean;
  onToggle: (on: boolean) => void;
  onDisconnect: () => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-4 py-3",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(c) => onToggle(c === true)}
      />
      <ConnectionIcon
        iconSlug={iconSlug}
        alt={title}
        size={18}
        className="shrink-0 text-foreground/80"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold text-foreground">{title}</p>
          {active && (
            <span className="rounded-full bg-success-light px-2 py-0.5 text-[11px] font-medium text-success">
              Connected
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onDisconnect}
        className="shrink-0 text-[13px] font-medium text-danger hover:underline"
      >
        Disconnect
      </button>
    </div>
  );
}
