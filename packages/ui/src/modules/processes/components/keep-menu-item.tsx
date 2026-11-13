import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";

import { ALWAYS_ON_KEEP_HINT, keepSourceCaption } from "../lib/process-copy.js";
import type { ProcessRow } from "../types.js";
import { MenuItemText } from "./menu-item-text.js";

interface Props {
  agentId: string;
  row: ProcessRow;
  alwaysOn: boolean;
}

export function KeepMenuItem({ row, alwaysOn }: Props) {
  return (
    <DropdownMenuCheckboxItem
      checked={row.keepsAwake}
      disabled={alwaysOn}
      data-testid="process-keep"
      className="h-auto py-2"
    >
      <MenuItemText
        label="Keep the agent awake"
        caption={alwaysOn ? ALWAYS_ON_KEEP_HINT : keepSourceCaption(row)}
        captionTestId="process-keep-source"
      />
    </DropdownMenuCheckboxItem>
  );
}
