import { Launch, TrashCan, ViewOff } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { repoSlug } from "@/lib/git-source";
import { cn } from "@/lib/utils";

export function SkillSourceHeader({
  source,
  visibility,
  badgeTitle,
  note,
  children,
}: {
  source: SkillSource;
  visibility?: "public" | "private";
  badgeTitle?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-md font-medium text-foreground">
            {source.name}
          </p>
          {note}
          {visibility === "private" && (
            <Badge variant="muted" className="shrink-0" title={badgeTitle}>
              Private
            </Badge>
          )}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {repoSlug(source.gitUrl)}
          {source.path ? ` · ${source.path}` : ""}
        </p>
      </div>
      {children}
    </div>
  );
}

export function SkillSourceActions({
  source,
  busy,
  onRescan,
  onRemove,
  onHide,
  hideBlocker,
  hideDisabled,
}: {
  source: SkillSource;
  busy: boolean;
  onRescan: () => void;
  onRemove?: () => void;
  onHide?: () => void;
  hideBlocker?: string | null;
  hideDisabled?: boolean;
}) {
  const canRemove = !source.system && !source.fromTemplate;
  return (
    <RowActionsMenu label="Source actions">
      <DropdownMenuItem disabled={busy} onSelect={onRescan}>
        Re-scan
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() =>
          window.open(source.gitUrl, "_blank", "noopener,noreferrer")
        }
      >
        <span className="flex-1">View on GitHub</span>
        <Launch size={14} />
      </DropdownMenuItem>
      {onHide && (
        <DropdownMenuItem
          disabled={hideDisabled || !!hideBlocker}
          onSelect={onHide}
          className={cn(hideBlocker && "h-auto items-start py-2")}
        >
          <ViewOff
            size={14}
            className={cn("shrink-0", hideBlocker && "mt-0.5")}
          />
          <span className="flex-1">
            Hide for this agent
            {hideBlocker && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {hideBlocker}
              </span>
            )}
          </span>
        </DropdownMenuItem>
      )}
      {canRemove && onRemove && (
        <DropdownMenuItem tone="danger" onSelect={onRemove}>
          <TrashCan size={14} />
          <span className="flex-1">Remove source</span>
        </DropdownMenuItem>
      )}
    </RowActionsMenu>
  );
}
