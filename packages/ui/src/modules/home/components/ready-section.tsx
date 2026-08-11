import { useState } from "react";

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

export function ReadySection() {
  const digestSince = useDigestSince();
  const { data: items } = useReadyItems(digestSince);
  const [expanded, setExpanded] = useState(false);

  const list = items ?? [];
  if (list.length === 0) return null;

  const current = list[0];
  if (!current) return null;
  const remaining = list.length - 1;

  return (
    <section className="space-y-3" aria-label="Ready for you">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">
          Ready for you
        </h2>
        <Badge variant="default" className="bg-accent text-white hover:bg-accent">
          {list.length}
        </Badge>
      </div>

      {expanded ? (
        <div className="space-y-2">
          {list.map((item) => (
            <ReadyCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div>
          <div className={cn("relative", remaining > 0 && "mb-5")}>
            {remaining >= 2 && (
              <div className="absolute -bottom-3 left-3 right-3 h-3 rounded-b-lg border border-t-0 border-border bg-card/40" />
            )}
            {remaining >= 1 && (
              <div className="absolute -bottom-1.5 left-1.5 right-1.5 h-3 rounded-b-lg border border-t-0 border-border bg-card/70" />
            )}
            <div className="relative z-10">
              <ReadyCard item={current} />
            </div>
          </div>
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[14px] text-muted-foreground hover:text-foreground transition-colors pt-1"
            >
              +{remaining} more ready
            </button>
          )}
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
