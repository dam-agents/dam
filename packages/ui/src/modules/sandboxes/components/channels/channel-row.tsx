import type { ReactNode } from "react";

import { LIST_ROW } from "@/components/ui/list-section";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

export function ChannelRow({
  title,
  badge,
  subtitle,
  actionsLabel,
  actions,
  menuTestId,
}: {
  title: string;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actionsLabel: string;
  actions?: ReactNode;
  menuTestId?: string;
}) {
  return (
    <div className={LIST_ROW}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-md font-medium text-foreground">
            {title}
          </p>
          {badge}
        </div>
        {subtitle && (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <RowActionsMenu label={actionsLabel} testId={menuTestId}>
          {actions}
        </RowActionsMenu>
      )}
    </div>
  );
}
