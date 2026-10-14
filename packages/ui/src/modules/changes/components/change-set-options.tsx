import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import type { ChangeSet } from "agent-runtime-api";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { TruncateStart } from "../../../components/truncate-start.js";
import {
  type ChangeSetGroup,
  changeSetLabel,
  groupChangeSets,
  hasNewChanges,
  type SeenEdits,
} from "../lib/change-set-groups.js";
import { DiffStatText } from "./diff-stat-text.js";

interface Props {
  changeSets: readonly ChangeSet[];
  selectedPath: string | null;
  seen: SeenEdits;
  onSelect: (path: string) => void;
  autoFocus?: boolean;
}

export function ChangeSetOptions({
  changeSets,
  selectedPath,
  seen,
  onSelect,
  autoFocus,
}: Props) {
  const [filter, setFilter] = useState("");
  const groups = groupChangeSets(changeSets, filter);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 p-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter repositories"
          aria-label="Filter repositories"
          autoFocus={autoFocus}
          className="h-8 text-xs"
        />
      </div>
      <div
        role="listbox"
        aria-label="Change sets"
        className="min-h-0 overflow-y-auto pb-2"
      >
        {groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {changeSets.length === 0
              ? "No git repositories found."
              : "No repository matches."}
          </p>
        ) : (
          groups.map((group) => (
            <OptionGroup
              key={group.id}
              group={group}
              collapsible={group.id === "clean" && !filter}
              selectedPath={selectedPath}
              seen={seen}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OptionGroup({
  group,
  collapsible,
  selectedPath,
  seen,
  onSelect,
}: {
  group: ChangeSetGroup;
  collapsible: boolean;
  selectedPath: string | null;
  seen: SeenEdits;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div role="group" aria-label={group.label}>
      {collapsible ? (
        <button
          type="button"
          className="flex w-full items-center gap-1 px-3 pt-2 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Chevron size={12} />
          {group.label} ({group.changeSets.length})
        </button>
      ) : (
        <div className="px-3 pt-2 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {group.label}
        </div>
      )}
      {expanded &&
        group.changeSets.map((changeSet) => (
          <ChangeSetOption
            key={changeSet.path}
            changeSet={changeSet}
            selected={changeSet.path === selectedPath}
            fresh={hasNewChanges(changeSet, seen, selectedPath)}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function ChangeSetOption({
  changeSet,
  selected,
  fresh,
  onSelect,
}: {
  changeSet: ChangeSet;
  selected: boolean;
  fresh: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(changeSet.path)}
      className={cn(
        "flex w-full min-w-0 flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-muted",
        selected && "bg-muted",
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-2 text-xs text-foreground">
        <span className="truncate font-medium">
          {changeSetLabel(changeSet)}
        </span>
        {fresh && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            aria-label="New changes"
            title="New changes"
          />
        )}
        <DiffStatText stat={changeSet.stat} className="ml-auto shrink-0" />
      </span>
      <TruncateStart
        className="font-mono text-2xs text-muted-foreground"
        title={changeSet.path}
      >
        {changeSet.path}
      </TruncateStart>
    </button>
  );
}
