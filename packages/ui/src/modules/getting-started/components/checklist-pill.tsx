import { ChevronUp, Close } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import { useExitAnimation } from "../hooks/use-exit-animation.js";
import { ProgressRing } from "./progress-ring.js";

interface Props {
  done: number;
  total: number;
  pulse: boolean;
  onExpand: () => void;
  onDismiss: () => void;
}

export function ChecklistPill({
  done,
  total,
  pulse,
  onExpand,
  onDismiss,
}: Props) {
  const { exiting, exit } = useExitAnimation(onDismiss);
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-1 rounded-lg border border-border bg-card pr-1 pl-2 shadow-lg",
        "animate-[dock-enter_0.3s_ease-out]",
        pulse && "animate-[dock-pulse_0.7s_ease-out]",
        exiting && "animate-[dock-exit_0.3s_ease-in_forwards]",
      )}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Get started, ${done} of ${total} done. Expand checklist`}
        className="flex flex-1 items-center gap-2.5 pr-2 transition-opacity hover:opacity-80"
      >
        <ProgressRing done={done} total={total} />
        <span className="text-sm font-semibold text-foreground">
          Get started
        </span>
        <span className="text-sm text-muted-foreground">
          {done}/{total}
        </span>
        <ChevronUp size={16} className="text-muted-foreground" />
      </button>
      <button
        type="button"
        aria-label="Dismiss checklist"
        onClick={exit}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <Close size={16} />
      </button>
    </div>
  );
}
