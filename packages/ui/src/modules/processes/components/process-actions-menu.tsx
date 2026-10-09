import { Document, OverflowMenuVertical } from "@carbon/icons-react";
import type { ProcessRow } from "agent-runtime-api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { cn } from "@/lib/utils";

import { KeepMenuItem } from "./keep-menu-item.js";
import { StopProcessMenuItem } from "./stop-process-menu-item.js";

interface Props {
  agentId: string;
  row: ProcessRow;
  alwaysOn: boolean;
  outputOpen: boolean;
  onToggleOutput: () => void;
}

export function ProcessActionsMenu({
  agentId,
  row,
  alwaysOn,
  outputOpen,
  onToggleOutput,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="process-menu-button"
          aria-label={`Actions for ${row.command}`}
          className={cn("shrink-0", HOVER_ACTION)}
          onClick={(event) => event.stopPropagation()}
        >
          <OverflowMenuVertical size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64"
        onClick={(event) => event.stopPropagation()}
      >
        {row.outputPath !== null && (
          <>
            <DropdownMenuItem onSelect={onToggleOutput}>
              <Document size={14} />
              {outputOpen ? "Close output" : "Show output"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {row.kind !== "turn" && (
          <>
            <KeepMenuItem agentId={agentId} row={row} alwaysOn={alwaysOn} />
            <DropdownMenuSeparator />
          </>
        )}
        <StopProcessMenuItem agentId={agentId} row={row} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
