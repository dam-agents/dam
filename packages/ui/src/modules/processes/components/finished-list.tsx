import type { FinishedRow as FinishedRowData } from "agent-runtime-api";

import { DisclosureToggle } from "@/components/ui/disclosure";

import { useStore } from "../../../store.js";
import { FinishedRow } from "./finished-row.js";
import { GROUP_HEADING_CLASS, GroupCount } from "./group-heading.js";

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
  const open = useStore((s) => s.finishedListOpen);
  const setOpen = useStore((s) => s.setFinishedListOpen);
  if (rows.length === 0) return null;
  return (
    <section>
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen(!open)}
        chevronSize={14}
        className={GROUP_HEADING_CLASS}
      >
        Recently finished
        <GroupCount count={rows.length} />
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
    </section>
  );
}
