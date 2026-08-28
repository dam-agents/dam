import { Pause, Play, Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { SelfRefresh } from "../hooks/use-self-refresh.js";
import { selfRefreshLabel } from "../lib/self-refresh.js";

export function ArtifactSelfRefreshChip({
  selfRefresh,
  className,
}: {
  selfRefresh: SelfRefresh;
  className?: string;
}) {
  const { selfRefreshing, hold, gate } = selfRefresh;
  if (!selfRefreshing) return null;

  const paused = hold === "paused";
  const pausable = hold !== "bound";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 bg-muted/40 px-4 py-1.5 text-xs",
        className,
      )}
    >
      {hold ? (
        <Pause size={14} className="shrink-0 text-muted-foreground" />
      ) : (
        <Renew size={14} className="shrink-0 animate-spin text-info" />
      )}
      <span className="min-w-0 flex-1 text-muted-foreground">
        {selfRefreshLabel(hold)}
      </span>
      {pausable && (
        <Button
          variant="ghost"
          size="xs"
          onClick={paused ? gate.resume : gate.pause}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? "Resume" : "Pause"}
        </Button>
      )}
    </div>
  );
}
