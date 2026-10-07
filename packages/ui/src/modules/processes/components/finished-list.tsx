import type { FinishedRow as FinishedRowData } from "agent-runtime-api";
import { useState } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";

import { FinishedRow } from "./finished-row.js";

interface Props {
  rows: readonly FinishedRowData[];
  now: Date;
  openOutputKey: string | null;
  onOpenOutput: (key: string) => void;
}

export function FinishedList({
  rows,
  now,
  openOutputKey,
  onOpenOutput,
}: Props) {
  const [open, setOpen] = useState(true);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col">
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen(!open)}
        chevronSize={14}
        chevronClassName="text-muted-foreground"
        className="px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        Recently finished ({rows.length})
      </DisclosureToggle>
      {open && (
        <ul>
          {rows.map((row) => (
            <FinishedRow
              key={row.key}
              row={row}
              now={now}
              outputOpen={row.key === openOutputKey}
              onOpenOutput={onOpenOutput}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
