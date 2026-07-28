import { MoreVertical, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { LineageRow } from "../lib/sandbox-groups.js";
import { ExperimentStatusBadge } from "./experiment-status-badge.js";
import { LineageRuns } from "./lineage-runs.js";

interface Props {
  lineage: LineageRow;
  /** False once the sandbox is deleted: browsable, but routes nowhere. */
  openable: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

/** One experiment inside its sandbox, revealing its runs. Opens the sandbox
 *  chat — a sandbox holds many experiments, so there's no page of its own. */
export function LineageCard({ lineage, openable, onOpen, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-border-light bg-surface">
      <div
        role={openable ? "button" : undefined}
        tabIndex={openable ? 0 : undefined}
        onClick={openable ? onOpen : undefined}
        onKeyDown={(e) => openable && e.key === "Enter" && onOpen()}
        className={cn(
          "flex items-center gap-3 px-[18px] py-4",
          openable &&
            "cursor-pointer transition-colors hover:bg-surface-raised",
        )}
      >
        {/* Closed reads as a plain chevron; open boxes it, so an expanded row is
            obvious without reading the runs below. */}
        <button
          type="button"
          title={expanded ? "Collapse runs" : "Show runs"}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md transition-all",
            expanded ? "size-7 border border-border" : "size-5",
          )}
        >
          <span
            className={cn(
              "text-[20px] leading-none transition-transform",
              expanded ? "rotate-90 text-foreground" : "text-muted-foreground",
            )}
            aria-hidden
          >
            ›
          </span>
        </button>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-semibold text-foreground">
            {lineage.name}
          </span>
          {/* Just the run count: invocation counts belong on the run rows, where
              they say which run they describe. */}
          <span className="truncate text-[13px] text-muted-foreground">
            {lineage.runCount} run{lineage.runCount === 1 ? "" : "s"}
          </span>
        </div>

        <span className="ml-auto shrink-0">
          <ExperimentStatusBadge status={lineage.badge} />
        </span>
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="More actions">
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                tone="danger"
                disabled={lineage.liveCount > 0}
                title={
                  lineage.liveCount > 0
                    ? "Stop the live run before deleting"
                    : undefined
                }
                onSelect={onDelete}
              >
                <Trash2 size={14} />
                Delete experiment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Mounted only when expanded, so the run details and per-run feeds
          are fetched lazily, card by card. */}
      {expanded && (
        <LineageRuns
          driverAgentId={lineage.driverAgentId}
          name={lineage.name}
        />
      )}
    </div>
  );
}
