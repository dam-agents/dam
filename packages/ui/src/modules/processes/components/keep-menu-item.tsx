import type { ProcessRow } from "agent-runtime-api";

import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";

import { useSetKeep } from "../api/mutations.js";
import { MenuItemText } from "./menu-item-text.js";

interface Props {
  agentId: string;
  row: ProcessRow;
}

export function KeepMenuItem({ agentId, row }: Props) {
  const setKeep = useSetKeep(agentId);
  return (
    <DropdownMenuCheckboxItem
      checked={row.keepsAwake}
      onCheckedChange={(next) =>
        setKeep.mutate({ key: row.key, keepsAwake: next })
      }
      data-testid="process-keep"
      className="h-auto py-2"
    >
      <MenuItemText label="Keep the agent awake" />
    </DropdownMenuCheckboxItem>
  );
}
