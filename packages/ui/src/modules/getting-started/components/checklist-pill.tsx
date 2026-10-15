import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ProgressRing } from "./progress-ring.js";

interface Props {
  done: number;
  total: number;
  pulse: boolean;
  expanded: boolean;
  tooltipSide: "left" | "bottom";
  onToggle: () => void;
}

export function ChecklistPill({
  done,
  total,
  pulse,
  expanded,
  tooltipSide,
  onToggle,
}: Props) {
  const label = `Get started, ${done} of ${total} done`;
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={expanded}
        className={cn(
          "flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-muted",
          "animate-[dock-enter_0.3s_ease-out]",
          pulse && "animate-[dock-pulse_0.7s_ease-out]",
          expanded && "bg-muted",
        )}
      >
        <ProgressRing done={done} total={total} />
      </button>
    </Tooltip>
  );
}
