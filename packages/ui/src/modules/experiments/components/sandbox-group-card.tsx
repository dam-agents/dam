import { cn } from "@/lib/utils";

import type { LineageRow, SandboxGroup } from "../lib/sandbox-groups.js";
import { ExperimentStatusBadge } from "./experiment-status-badge.js";
import { LineageCard } from "./lineage-card.js";

interface Props {
  group: SandboxGroup;
  onOpenSandbox: (agentId: string) => void;
  onDeleteLineage: (lineage: LineageRow) => void;
}

/** A sandbox and the experiments it holds, including none yet. No container
 *  box, per the design: the header sits bare on the page and only the
 *  experiment cards are bordered — the grouping reads from proximity. */
export function SandboxGroupCard({
  group,
  onOpenSandbox,
  onDeleteLineage,
}: Props) {
  const deleted = group.agent === null;
  const count = group.lineages.length;
  const open = () => onOpenSandbox(group.agentId);

  return (
    <section>
      <div
        role={deleted ? undefined : "button"}
        tabIndex={deleted ? undefined : 0}
        onClick={deleted ? undefined : open}
        onKeyDown={(e) => !deleted && e.key === "Enter" && open()}
        // The hairline under the header is what scopes the group now that the
        // container box is gone.
        className={cn(
          "group/head mb-3 flex w-full items-center gap-2.5 border-b border-border px-1.5 pb-3 pt-1.5 text-left",
          !deleted && "cursor-pointer transition-colors hover:bg-info-light",
        )}
      >
        <span
          className={cn(
            "truncate text-sm font-semibold",
            deleted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {group.name}
        </span>
        <span className="shrink-0 text-border" aria-hidden>
          ·
        </span>
        <span className="shrink-0 text-[12.5px] text-muted-foreground">
          {count === 0
            ? "No experiments"
            : `${count} experiment${count === 1 ? "" : "s"}`}
        </span>
        {group.rollup && (
          <span className="ml-auto shrink-0">
            <ExperimentStatusBadge status={group.rollup} />
          </span>
        )}
        {!deleted && (
          <span
            className={cn(
              "shrink-0 text-[12.5px] font-medium text-muted-foreground transition-colors group-hover/head:text-accent",
              group.rollup ? "ml-3.5" : "ml-auto",
            )}
          >
            Open sandbox →
          </span>
        )}
      </div>

      {deleted && (
        <p className="mb-3 px-1.5 text-xs text-muted-foreground">
          These sandboxes were deleted; their runs and results still live in the
          artifact library.
        </p>
      )}

      {count === 0 ? (
        <p className="px-1.5 text-sm text-muted-foreground">
          No experiments yet — open the sandbox chat and ask the agent to set
          one up.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {group.lineages.map((lineage) => (
            <LineageCard
              key={lineage.key}
              lineage={lineage}
              openable={!deleted}
              onOpen={open}
              onDelete={() => onDeleteLineage(lineage)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
