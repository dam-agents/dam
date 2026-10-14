import { WarningAltFilled } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { LEVEL_ICON, segmentFill } from "../lib/pool-colors.js";
import type { PoolBarView, PoolSegment } from "../lib/pools.js";

interface Props {
  title: string;
  value: string;
  bar: PoolBarView;
  valueText: string;
  percent?: number;
  warning: string;
}

export function PoolBar({
  title,
  value,
  bar,
  valueText,
  percent,
  warning,
}: Props) {
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
                  LEVEL_ICON[bar.level],
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
        aria-valuetext={valueText}
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
            fill={segmentFill(bar.level, segment.filled)}
          />
        ))}
      </div>
    </div>
  );
}

const SEGMENT_FOCUS =
  "h-full shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Segment({ segment, fill }: { segment: PoolSegment; fill: string }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const { agentId, label } = segment;
  const style = { width: `${segment.fraction * 100}%` };
  return (
    <Tooltip content={label}>
      {agentId ? (
        <button
          type="button"
          aria-label={label}
          onClick={() => navigateToSandboxHome(agentId, "setup")}
          className={cn(SEGMENT_FOCUS, "cursor-pointer", fill)}
          style={style}
        />
      ) : (
        <span
          role="img"
          tabIndex={0}
          aria-label={label}
          className={cn(SEGMENT_FOCUS, fill)}
          style={style}
        />
      )}
    </Tooltip>
  );
}
