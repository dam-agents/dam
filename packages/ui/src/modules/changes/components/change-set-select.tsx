import { ChevronDown } from "@carbon/icons-react";
import type { ChangeSet } from "agent-runtime-api";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  changeSetLabel,
  hasNewChanges,
  type SeenEdits,
} from "../lib/change-set-groups.js";
import { ChangeSetOptions } from "./change-set-options.js";

interface Props {
  changeSets: readonly ChangeSet[];
  selected: ChangeSet | null;
  seen: SeenEdits;
  onSelect: (path: string) => void;
}

export function ChangeSetSelect({
  changeSets,
  selected,
  seen,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const fresh = changeSets.some((changeSet) =>
    hasNewChanges(changeSet, seen, selected?.path ?? null),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Change set"
          title={selected?.path}
          className="flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-left text-xs hover:bg-muted"
        >
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {selected ? changeSetLabel(selected) : "Choose a change set"}
          </span>
          {fresh && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              aria-label="New changes in another change set"
              title="New changes in another change set"
            />
          )}
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[60vh] w-[min(28rem,90vw)] flex-col p-0"
      >
        <ChangeSetOptions
          changeSets={changeSets}
          selectedPath={selected?.path ?? null}
          seen={seen}
          autoFocus
          onSelect={(path) => {
            onSelect(path);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
