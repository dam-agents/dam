import { cn } from "@/lib/utils";

import type { LineageRow, SandboxGroup } from "../lib/sandbox-groups.js";
import { ExperimentStatusBadge } from "./experiment-status-badge.js";
import { LineageCard } from "./lineage-card.js";

interface Props {
  group: SandboxGroup;
  onOpenSandbox: (agentId: string) => void;
  onDeleteLineage: (lineage: LineageRow) => void;
}

/** A sandbox and the experiments it holds, including none yet. The sandbox is a
 *  visible container that bundles them, so ownership reads off the page. */
export function SandboxGroupCard({
  group,
  onOpenSandbox,
  onDeleteLineage,
}: Props) {
  const deleted = group.agent === null;
  const count = group.lineages.length;
  const live = group.lineages.some((lineage) => lineage.liveCount > 0);
  const open = () => onOpenSandbox(group.agentId);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-surface",
        // A live run tints the whole container, so a busy sandbox is findable
        // without reading any row.
        live ? "border-success" : "border-border",
        deleted && "border-dashed",
      )}
    >
      {deleted && (
        <p className="px-4 pt-2.5 text-[12px] text-text-muted">
          This sandbox was deleted; its runs and results still live in the
          artifact library.
        </p>
      )}

      <div
        role={deleted ? undefined : "button"}
        tabIndex={deleted ? undefined : 0}
        onClick={deleted ? undefined : open}
        onKeyDown={(e) => !deleted && e.key === "Enter" && open()}
        className={cn(
          "group/head flex w-full items-center gap-2.5 border-b border-border-light px-4 py-3.5 text-left",
          !deleted && "cursor-pointer transition-colors hover:bg-info-light",
        )}
      >
        <span
          className={cn(
            "truncate text-[14px] font-semibold",
            deleted ? "text-text-muted" : "text-foreground",
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

      {count === 0 ? (
        <p className="px-4 py-[18px] text-[13px] text-muted-foreground">
          No experiments yet — open the sandbox chat and ask the agent to set
          one up.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5 p-3">
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
    </div>
  );
}
