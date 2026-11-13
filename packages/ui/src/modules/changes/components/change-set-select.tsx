import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { TruncateStart } from "@/components/truncate-start";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  changeSetLabel,
  groupChangeSets,
  hasNewChanges,
} from "../lib/change-set-groups.js";
import type { ChangeSet } from "../types.js";

interface ChangeSetSelectProps {
  changeSets: ChangeSet[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function ChangeSetSelect({
  changeSets,
  selectedPath,
  onSelect,
}: ChangeSetSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [cleanCollapsed, setCleanCollapsed] = useState(true);
  const selected = changeSets.find((cs) => cs.path === selectedPath);
  const showDot = hasNewChanges(changeSets, selectedPath);

  const filtered = useMemo(() => {
    if (!filter) return changeSets;
    const q = filter.toLowerCase();
    return changeSets.filter(
      (cs) =>
        cs.repository.name.toLowerCase().includes(q) ||
        (cs.branch ?? "").toLowerCase().includes(q) ||
        cs.path.toLowerCase().includes(q),
    );
  }, [changeSets, filter]);

  const groups = useMemo(() => groupChangeSets(filtered), [filtered]);

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setFilter("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 max-w-48 shrink items-center gap-1 rounded-md border border-input px-2.5 text-left text-xs hover:bg-muted"
        >
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {selected ? changeSetLabel(selected) : "Select a repo…"}
          </span>
          {showDot && (
            <span className="size-2 shrink-0 rounded-full bg-accent" />
          )}
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="p-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter repositories"
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto pb-1">
          {groups.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No matches
            </p>
          )}
          {groups.map((group) => {
            const isClean = group.key === "clean";
            const isCollapsed = isClean && cleanCollapsed;

            return (
              <div key={group.key}>
                {isClean ? (
                  <button
                    type="button"
                    onClick={() => setCleanCollapsed((c) => !c)}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                    {group.label} ({group.changeSets.length})
                  </button>
                ) : (
                  <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                )}
                {!isCollapsed &&
                  group.changeSets.map((cs) => {
                    const isSelected = cs.path === selectedPath;
                    const hasNew =
                      cs.sessionEditedAt !== null && cs.path !== selectedPath;

                    return (
                      <button
                        key={cs.path}
                        type="button"
                        onClick={() => {
                          onSelect(cs.path);
                          setOpen(false);
                          setFilter("");
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted",
                          isSelected && "bg-muted",
                        )}
                      >
                        {hasNew && (
                          <span className="size-2 shrink-0 rounded-full bg-accent" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-sm text-foreground",
                              isSelected && "font-medium",
                            )}
                          >
                            {changeSetLabel(cs)}
                          </span>
                          <TruncateStart className="block text-xs text-muted-foreground">
                            {cs.path}
                          </TruncateStart>
                        </span>
                        {(cs.stat.additions > 0 || cs.stat.deletions > 0) && (
                          <span className="shrink-0 text-xs tabular-nums">
                            <span className="text-[#24a148]">
                              +{cs.stat.additions}
                            </span>{" "}
                            <span className="text-[#da1e28]">
                              −{cs.stat.deletions}
                            </span>
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
