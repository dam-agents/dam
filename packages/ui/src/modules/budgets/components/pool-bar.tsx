import { WarningAltFilled } from "@carbon/icons-react";
import type { PoolLevel } from "api-server-api";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { PoolBarView, PoolSegment } from "../lib/pools.js";

const FILL: Record<PoolLevel, string> = {
  ok: "bg-accent",
  warning: "bg-warning",
  critical: "bg-destructive",
};

const ICON: Record<PoolLevel, string> = {
  ok: "",
  warning: "text-warning",
  critical: "text-destructive",
};

interface Props {
  title: string;
  value: string;
  bar: PoolBarView;
  percent: number;
  warning: string;
}

export function PoolBar({ title, value, bar, percent, warning }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-foreground">
          {title}
          {bar.level !== "ok" && (
            <Tooltip content={warning}>
              <span
                role="img"
                tabIndex={0}
                aria-label={warning}
                className={cn(
                  "inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ICON[bar.level],
                )}
              >
                <WarningAltFilled size={14} />
              </span>
            </Tooltip>
          )}
        </span>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      <span
        role="meter"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={value}
        className="sr-only"
      />
      <div
        role="group"
        aria-label={`${title} by agent`}
        className="flex h-3 w-full gap-px overflow-hidden rounded-sm bg-muted"
      >
        {bar.segments.map((segment) => (
          <Segment
            key={segment.agentId ?? segment.label}
            segment={segment}
            fill={segment.filled ? FILL[bar.level] : "bg-muted-foreground/30"}
          />
        ))}
      </div>
    </div>
  );
}

function Segment({ segment, fill }: { segment: PoolSegment; fill: string }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const { agentId, label } = segment;
  const style = { width: `${segment.fraction * 100}%` };
  if (!agentId)
    return (
      <Tooltip content={label}>
        <span className={cn("h-full shrink-0", fill)} style={style} />
      </Tooltip>
    );
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => navigateToSandboxHome(agentId, "setup")}
        className={cn("h-full shrink-0 cursor-pointer", fill)}
        style={style}
      />
    </Tooltip>
  );
}
