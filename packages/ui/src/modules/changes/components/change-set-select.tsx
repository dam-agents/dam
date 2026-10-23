import { ChevronDown } from "@carbon/icons-react";
import type { ChangeSet } from "agent-runtime-api";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { TruncateStart } from "../../../components/truncate-start.js";
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
          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-left hover:bg-muted"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium text-foreground">
              {selected ? changeSetLabel(selected) : "Choose a change set"}
            </span>
            {selected && (
              <TruncateStart
                className="font-mono text-2xs text-muted-foreground"
                title={selected.path}
              >
                {selected.path}
              </TruncateStart>
            )}
          </span>
          {fresh && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              aria-label="New changes in another change set"
              title="New changes in another change set"
            />
          )}
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        tail={false}
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
