import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useDigestSince } from "../home-digest-store.js";
import { type ReadyItem, useReadyItems } from "../home-ready-data.js";
import { formatRelative } from "../lib/format-time.js";

const TYPE_LABELS: Record<ReadyItem["type"], string> = {
  pr_ready: "PR",
  artifact_ready: "Artifact",
  suggestion: "Suggestion",
  run_complete: "Completed",
};

type ReadyFilter = "all" | "artifact_ready" | "run_complete" | "pr_ready" | "suggestion";

const FILTER_TABS: { value: ReadyFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "artifact_ready", label: "Artifacts" },
  { value: "run_complete", label: "Tasks" },
  { value: "pr_ready", label: "PRs" },
  { value: "suggestion", label: "Suggestions" },
];

export function ReadySection() {
  const digestSince = useDigestSince();
  const { data: items } = useReadyItems(digestSince);
  const [filter, setFilter] = useState<ReadyFilter>("all");

  const list = items ?? [];

  const filtered = useMemo(
    () => filter === "all" ? list : list.filter((i) => i.type === filter),
    [list, filter],
  );

  if (list.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Ready for you">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">
          Ready for you
        </h2>
        <Badge variant="default" className="bg-accent text-white hover:bg-accent">
          {list.length}
        </Badge>
      </div>

      <div className="flex gap-1 border-b border-border">
        {FILTER_TABS.map((tab) => {
          const count = tab.value === "all"
            ? list.length
            : list.filter((i) => i.type === tab.value).length;
          if (tab.value !== "all" && count === 0) return null;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={cn(
                "px-3 py-2 text-[14px] font-medium border-b-2 -mb-px transition-colors",
                filter === tab.value
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count > 0 && (
                <span className="ml-1.5 text-muted-foreground">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="text-[14px] text-muted-foreground py-4">
          No {FILTER_TABS.find((t) => t.value === filter)?.label.toLowerCase()} ready.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <ReadyCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReadyCard({ item }: { item: ReadyItem }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => navigateToSandboxHome(item.agentId)}
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
        >
          {item.agentName}
        </button>
        <Badge variant="muted" size="sm">
          {TYPE_LABELS[item.type]}
        </Badge>
        <span className="ml-auto text-[14px] text-muted-foreground shrink-0">
          {formatRelative(item.completedAt)}
        </span>
      </div>

      <p className="text-[14px] font-medium text-foreground mb-1">{item.title}</p>
      {item.subtitle && (
        <p className="text-[14px] text-muted-foreground mb-3">{item.subtitle}</p>
      )}

      <Button size="sm" variant="outline">
        {item.actionLabel}
      </Button>
    </div>
  );
}
