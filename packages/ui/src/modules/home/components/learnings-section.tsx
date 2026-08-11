import { useState } from "react";

import { Badge } from "@/components/ui/badge";

import { useStore } from "../../../store.js";
import { useDigestSince } from "../home-digest-store.js";
import { type LearningItem, useLearningItems } from "../home-learnings-data.js";
import { SECTION_COLLAPSE_LIMITS } from "../home-thresholds.js";
import { formatRelative } from "../lib/format-time.js";

export function LearningsSection() {
  const digestSince = useDigestSince();
  const { data: items } = useLearningItems(digestSince);
  const [expanded, setExpanded] = useState(false);

  const list = items ?? [];
  if (list.length === 0) return null;

  const limit = SECTION_COLLAPSE_LIMITS.learnings;
  const visible = expanded ? list : list.slice(0, limit);
  const hasMore = list.length > limit;

  return (
    <section className="space-y-3" aria-label="Learnings">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">Learnings</h2>
        <Badge variant="default" className="bg-accent text-white hover:bg-accent">
          {list.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {visible.map((item) => (
          <LearningCard key={item.id} item={item} />
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

function LearningCard({ item }: { item: LearningItem }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

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
        <Badge variant="muted" size="sm">
          {item.sourceCount} source{item.sourceCount !== 1 ? "s" : ""}
        </Badge>
        <span className="ml-auto text-[14px] text-muted-foreground shrink-0">
          {formatRelative(item.indexedAt)}
        </span>
      </div>

      <p className="text-[14px] font-medium text-foreground mb-1">{item.title}</p>
      <p className="text-[14px] text-muted-foreground line-clamp-2">{item.summary}</p>
    </div>
  );
}
