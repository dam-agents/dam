import { OverflowMenuHorizontal } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LIST_ROW } from "@/components/ui/list-section";

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
  actions: ReactNode;
  menuTestId?: string;
}) {
  return (
    <div className={LIST_ROW}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] text-foreground">{title}</p>
          {badge}
        </div>
        {subtitle && (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={actionsLabel}
            data-testid={menuTestId}
          >
            <OverflowMenuHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>{actions}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
