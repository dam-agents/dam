import { OverflowMenuHorizontal } from "@carbon/icons-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The "⋯" button that opens a row's or panel's
 * actions. Every list row uses it so the icon, size, label and menu placement
 * are the same everywhere; dense rows that reveal it on hover pass `dense`.
 */
export function RowActionsMenu({
  label,
  testId,
  dense = false,
  variant = "ghost",
  className,
  disabled,
  stopPropagation = false,
  onOpenChange,
  contentProps,
  children,
}: {
  label: string;
  testId?: string;
  dense?: boolean;
  variant?: "ghost" | "outline";
  className?: string;
  disabled?: boolean;
  stopPropagation?: boolean;
  onOpenChange?: (open: boolean) => void;
  contentProps?: ComponentProps<typeof DropdownMenuContent>;
  children: ReactNode;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={dense ? "icon-xs" : "icon-sm"}
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          className={cn("shrink-0 text-muted-foreground", className)}
          {...(stopPropagation && {
            onClick: (e) => e.stopPropagation(),
            onMouseDown: (e) => e.stopPropagation(),
          })}
        >
          <OverflowMenuHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...contentProps}>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
