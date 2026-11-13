import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useState } from "react";

import { TruncateStart } from "@/components/truncate-start";
import { cn } from "@/lib/utils";

import {
  changeSetLabel,
  groupChangeSets,
  hasNewChanges,
} from "../lib/change-set-groups.js";
import type { ChangeSet } from "../types.js";

interface ChangeSetOptionsProps {
  changeSets: ChangeSet[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function ChangeSetOptions({
  changeSets,
  selectedPath,
  onSelect,
}: ChangeSetOptionsProps) {
  const groups = groupChangeSets(changeSets);
  const [cleanCollapsed, setCleanCollapsed] = useState(true);

  return (
    <div className="max-h-64 overflow-y-auto py-1">
      {groups.map((group) => {
        const isClean = group.key === "clean";
        const isCollapsed = isClean && cleanCollapsed;

        return (
          <div key={group.key}>
            {isClean ? (
              <button
                type="button"
                onClick={() => setCleanCollapsed((c) => !c)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted"
              >
                {isCollapsed ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                {group.label} ({group.changeSets.length})
              </button>
            ) : (
              <div className="px-3 py-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
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
                    onClick={() => onSelect(cs.path)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                      isSelected && "bg-muted font-medium",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">
                        {changeSetLabel(cs)}
                      </span>
                      <TruncateStart className="block text-2xs text-muted-foreground">
                        {cs.path}
                      </TruncateStart>
                    </span>
                    {hasNew && (
                      <span className="size-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </button>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
