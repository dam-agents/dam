import type { PoolLevel } from "api-server-api";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  formatBytes,
  type PoolBarView,
  type PoolSegment,
} from "../lib/pools.js";

const FILL: Record<PoolLevel, string> = {
  ok: "bg-accent",
  warning: "bg-warning",
  critical: "bg-destructive",
};

const FULL_TEXT: Record<PoolLevel, string | null> = {
  ok: null,
  warning: "Getting full",
  critical: "Full",
};

interface Props {
  title: string;
  bar: PoolBarView;
  levelText?: Record<PoolLevel, string | null>;
  detail?: string;
}

export function PoolBar({ title, bar, levelText = FULL_TEXT, detail }: Props) {
  const text = levelText[bar.level];
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
          {text && <span className="mr-1.5 font-semibold">{text}</span>}
          {detail ??
            `${formatBytes(bar.usedBytes)} of ${formatBytes(bar.limitBytes)} · ${bar.percent}%`}
        </span>
      </div>
      <div
        role="meter"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bar.percent}
        aria-valuetext={`${bar.percent}%${text ? `, ${text}` : ""}`}
        className="flex h-3 w-full gap-px overflow-hidden rounded-sm bg-muted"
      >
        {bar.segments.map((segment) => (
          <Segment
            key={segment.agentId ?? segment.label}
            segment={segment}
            width={`${bar.limitBytes > 0 ? (segment.bytes * 100) / bar.limitBytes : 0}%`}
            fill={segment.filled ? FILL[bar.level] : "bg-muted-foreground/30"}
            share={
              detail && !segment.agentId
                ? segment.label
                : `${segment.label} · ${formatBytes(segment.bytes)}`
            }
          />
        ))}
      </div>
    </div>
  );
}

function Segment({
  segment,
  width,
  fill,
  share,
}: {
  segment: PoolSegment;
  width: string;
  fill: string;
  share: string;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const { agentId } = segment;
  return (
    <Tooltip content={share}>
      {agentId ? (
        <button
          type="button"
          aria-label={share}
          onClick={() => navigateToSandboxHome(agentId, "setup")}
          className={cn("h-full shrink-0 cursor-pointer", fill)}
          style={{ width }}
        />
      ) : (
        <span className={cn("h-full shrink-0", fill)} style={{ width }} />
      )}
    </Tooltip>
  );
}
