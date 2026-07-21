import type { ForkView } from "api-server-api";
import { GitFork } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { timeAgo } from "../../artifacts/lib/format.js";

const PHASE_LABELS: Record<string, string> = {
  Ready: "Running",
  Pending: "Starting",
  Hibernated: "Hibernated",
  Failed: "Failed",
  Completed: "Ended",
};

const PHASE_VARIANTS: Record<string, "success" | "info" | "muted" | "danger"> =
  {
    Ready: "success",
    Pending: "info",
    Hibernated: "muted",
    Failed: "danger",
    Completed: "muted",
  };

interface Props {
  fork: ForkView;
  /** Primary line: the replier (owner view) or the parent agent (my-forks view). */
  title: string;
  onEnd: (fork: ForkView) => void;
}

export function ForkRow({ fork, title, onEnd }: Props) {
  return (
    <div
      className="flex items-center gap-3 border-t border-border px-4 py-2.5"
      data-testid="fork-row"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-light text-accent">
        <GitFork size={15} />
      </div>
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-[14px] font-medium text-foreground">
          {title}
          <Badge variant="accent" className="px-1.5 py-0 text-[11px]">
            Fork
          </Badge>
        </span>
        <span className="text-[12px] text-muted-foreground">
          {fork.lastActivityAt
            ? `active ${timeAgo(fork.lastActivityAt)}`
            : "no activity yet"}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Badge variant={PHASE_VARIANTS[fork.phase ?? ""] ?? "muted"}>
          {(fork.phase && PHASE_LABELS[fork.phase]) ?? "Unknown"}
        </Badge>
        <Button size="sm" variant="outline" onClick={() => onEnd(fork)}>
          End now
        </Button>
      </div>
    </div>
  );
}
