import { Settings } from "@carbon/icons-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import type { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { cn } from "@/lib/utils";

import type {
  ApprovalAction,
  ApprovalActionId,
} from "../hooks/use-approval-actions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: an approval's controls: the `inline` actions as buttons, every other action in one "⋯" menu with the way to the network rules under them, and no menu when it would hold nothing. The Home feed and the chat prompt both render it, so an approval offers the same actions and the same labels wherever the owner meets it; the caller names the inline actions and the button variant its surface uses.
 */
export function ApprovalActionsMenu({
  actions,
  inline = ["allow-once"],
  onRun,
  inflight,
  hostLabel,
  openSettings,
  variant,
  className,
  contentProps,
}: {
  actions: readonly ApprovalAction[];
  inline?: readonly ApprovalActionId[];
  onRun: (action: ApprovalAction) => void;
  inflight: boolean;
  hostLabel: string | null;
  openSettings: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
  contentProps?: ComponentProps<typeof DropdownMenuContent>;
}) {
  const shown = actions.filter((action) => inline.includes(action.id));
  const menu = actions.filter((action) => !inline.includes(action.id));

  return (
    <>
      {shown.map((action) => (
        <Button
          key={action.id}
          variant={variant}
          size="sm"
          disabled={action.disabled}
          tooltip={action.tooltip}
          onClick={() => onRun(action)}
          className={className}
        >
          {action.label}
        </Button>
      ))}
      {(menu.length > 0 || hostLabel !== null) && (
        <RowActionsMenu
          label="More approval actions"
          variant="outline"
          className={cn("h-8 w-8", className)}
          disabled={inflight}
          contentProps={contentProps}
        >
          {menu.map((action) => (
            <DropdownMenuItem
              key={action.id}
              disabled={action.disabled}
              tone={action.danger ? "danger" : "default"}
              onSelect={() => onRun(action)}
              title={action.tooltip}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
          {hostLabel !== null && (
            <>
              <DropdownMenuSeparator className="-mx-1" />
              <DropdownMenuItem onSelect={openSettings}>
                <Settings size={16} />
                Network settings
              </DropdownMenuItem>
            </>
          )}
        </RowActionsMenu>
      )}
    </>
  );
}
