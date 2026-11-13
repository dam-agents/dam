import { StopFilledAlt } from "@carbon/icons-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { NO_PID_STOP_HINT } from "../lib/process-copy.js";
import type { ProcessRow } from "../types.js";
import { MenuItemText } from "./menu-item-text.js";

interface Props {
  agentId: string;
  row: ProcessRow;
}

export function StopProcessMenuItem({ row }: Props) {
  if (row.pid == null)
    return (
      <DropdownMenuItem tone="danger" disabled className="h-auto py-2">
        <StopFilledAlt size={14} />
        <MenuItemText label="Stop" caption={NO_PID_STOP_HINT} />
      </DropdownMenuItem>
    );

  return (
    <DropdownMenuItem tone="danger" data-testid="process-stop">
      <StopFilledAlt size={14} />
      Stop…
    </DropdownMenuItem>
  );
}
