import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ComputeSegment } from "../lib/slots.js";

const SEGMENT_FILL: Record<ComputeSegment["state"], string> = {
  running: "bg-success",
  awake: "bg-accent",
  available: "border border-dashed border-muted-foreground/30",
};

interface Props {
  segments: readonly ComputeSegment[];
  totalSlots: number;
  label: (segment: ComputeSegment) => string;
  ariaLabel: string;
}

export function SlotBar({ segments, totalSlots, label, ariaLabel }: Props) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1fr))` }}
    >
      {segments.map((segment, index) => (
        <Tooltip key={index} content={label(segment)} side="top">
          <span
            aria-label={label(segment)}
            className="group grid gap-1.5"
            style={{
              gridColumn: `span ${segment.slots}`,
              gridTemplateColumns: `repeat(${segment.slots}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: segment.slots }, (_, cell) => (
              <span
                key={cell}
                className={cn(
                  "h-2 rounded-sm transition-shadow",
                  SEGMENT_FILL[segment.state],
                  segment.state !== "available" &&
                    "group-hover:ring-2 group-hover:ring-foreground/40",
                )}
              />
            ))}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}
