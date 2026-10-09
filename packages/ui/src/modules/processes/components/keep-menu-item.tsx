import type { ProcessRow } from "agent-runtime-api";

import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";

import { useSetKeep } from "../api/mutations.js";
import { ALWAYS_ON_KEEP_HINT, keepSourceCaption } from "../lib/process-copy.js";
import { MenuItemText } from "./menu-item-text.js";

interface Props {
  agentId: string;
  row: ProcessRow;
  alwaysOn: boolean;
}

export function KeepMenuItem({ agentId, row, alwaysOn }: Props) {
  const setKeep = useSetKeep(agentId);
  return (
    <DropdownMenuCheckboxItem
      checked={row.keepsAwake}
      disabled={alwaysOn}
      onCheckedChange={(next) =>
        setKeep.mutate({ key: row.key, keepsAwake: next })
      }
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
