import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useDigestSince } from "../home-digest-store.js";
import {
  formatDelta,
  type ResultItem,
  useResultItems,
} from "../home-results-data.js";
import { SECTION_COLLAPSE_LIMITS } from "../home-thresholds.js";
import { formatRelative } from "../lib/format-time.js";

export function ResultsSection() {
  const digestSince = useDigestSince();
  const { data: items } = useResultItems(digestSince);
  const [expanded, setExpanded] = useState(false);

  const list = items ?? [];
  if (list.length === 0) return null;

  const limit = SECTION_COLLAPSE_LIMITS.results;
  const visible = expanded ? list : list.slice(0, limit);
  const hasMore = list.length > limit;

  return (
    <section className="space-y-3" aria-label="Results">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">Results</h2>
        <Badge
          variant="default"
          className="bg-accent text-white hover:bg-accent"
        >
          {list.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {visible.map((item) => (
          <ResultCard key={item.id} item={item} />
        ))}
      </div>

      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[14px] font-medium text-accent hover:text-accent/80 transition-colors"
        >
          Show all {list.length}
        </button>
      )}
      {expanded && hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[14px] font-medium text-accent hover:text-accent/80 transition-colors"
        >
          Show fewer
        </button>
      )}
    </section>
  );
}

function ResultCard({ item }: { item: ResultItem }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const diff = item.result - item.baseline;
  const improved = diff > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => navigateToSandboxHome(item.agentId)}
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
        >
          {item.agentName}
        </button>
        {item.isSignificant && (
          <Badge
            variant="muted"
            size="sm"
            className="bg-success/10 text-success"
          >
            Significant
          </Badge>
        )}
        <span className="ml-auto text-[14px] text-muted-foreground shrink-0">
          {formatRelative(item.completedAt)}
        </span>
      </div>

      <p className="text-[14px] font-medium text-foreground mb-1">
        {item.experimentName}
      </p>

      <div className="flex items-baseline gap-3 mt-2">
        <span className="text-[14px] text-muted-foreground">
          {item.metric}:
        </span>
        <span
          className={cn(
            "text-[14px] font-medium tabular-nums",
            improved ? "text-success" : "text-danger",
          )}
        >
          {formatDelta(item.baseline, item.result, item.unit)}
        </span>
        <span className="text-[14px] text-muted-foreground">
          from {item.baseline}
          {item.unit}
        </span>
      </div>
    </div>
  );
}
