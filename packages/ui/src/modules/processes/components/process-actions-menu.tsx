import { Document } from "@carbon/icons-react";
import type { ProcessRow } from "agent-runtime-api";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

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
    <RowActionsMenu
      label={`Actions for ${row.command}`}
      testId="process-menu-button"
      dense
      className={HOVER_ACTION}
      stopPropagation
      contentProps={{
        className: "w-64",
        onClick: (event) => event.stopPropagation(),
      }}
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
    </RowActionsMenu>
  );
}
