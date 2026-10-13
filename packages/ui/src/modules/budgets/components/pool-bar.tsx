import type { PoolLevel } from "api-server-api";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { formatBytes, type PoolBarView } from "../lib/pools.js";

const AGENT_FILL: Record<PoolLevel, string> = {
  ok: "bg-accent",
  warning: "bg-warning",
  critical: "bg-destructive",
};

const LEVEL_TEXT: Record<PoolLevel, string | null> = {
  ok: null,
  warning: "Getting full",
  critical: "Full",
};

interface Props {
  title: string;
  bar: PoolBarView;
}

export function PoolBar({ title, bar }: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const levelText = LEVEL_TEXT[bar.level];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground">{title}</span>
        <span
          className={cn(
            "tabular-nums text-muted-foreground",
            bar.level === "warning" && "text-warning",
            bar.level === "critical" && "text-destructive",
          )}
        >
          {levelText && (
            <span className="mr-1.5 font-semibold">{levelText}</span>
          )}
          {formatBytes(bar.usedBytes)} of {formatBytes(bar.limitBytes)} ·{" "}
          {bar.percent}%
        </span>
      </div>
      <div
        role="meter"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bar.percent}
        aria-valuetext={`${bar.percent}%${levelText ? `, ${levelText}` : ""}`}
        className="flex h-3 w-full gap-px overflow-hidden rounded-sm bg-muted"
      >
        {bar.segments.map((segment) => {
          const share = `${segment.label} · ${formatBytes(segment.bytes)}`;
          const width = `${bar.limitBytes > 0 ? (segment.bytes * 100) / bar.limitBytes : 0}%`;
          const fill = segment.agentId
            ? AGENT_FILL[bar.level]
            : "bg-muted-foreground/30";
          return (
            <Tooltip key={segment.agentId ?? segment.label} content={share}>
              <button
                type="button"
                aria-label={share}
                aria-disabled={!segment.agentId}
                onClick={() =>
                  segment.agentId &&
                  navigateToSandboxHome(segment.agentId, "setup")
                }
                className={cn(
                  "h-full shrink-0",
                  fill,
                  segment.agentId && "cursor-pointer",
                )}
                style={{ width }}
              />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
