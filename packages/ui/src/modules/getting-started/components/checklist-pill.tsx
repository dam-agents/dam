import { ChevronUp, Close } from "@carbon/icons-react";
import type { Ref } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useExitAnimation } from "../hooks/use-exit-animation.js";
import { ProgressRing } from "./progress-ring.js";

interface Props {
  done: number;
  total: number;
  unseen: number;
  onExpand: () => void;
  onDismiss: () => void;
  ref?: Ref<HTMLButtonElement>;
}

export function ChecklistPill({
  done,
  total,
  unseen,
  onExpand,
  onDismiss,
  ref,
}: Props) {
  const { exiting, exit } = useExitAnimation(onDismiss);
  const label = `Get started, ${String(done)} of ${String(total)} done${
    unseen > 0 ? `, ${String(unseen)} new avatar${unseen === 1 ? "" : "s"}` : ""
  }`;
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-1 rounded-lg border border-border bg-card pr-1 pl-2 shadow-lg",
        "animate-[dock-enter_0.3s_ease-out]",
        exiting && "animate-[dock-exit_0.3s_ease-in_forwards]",
      )}
    >
      <button
        ref={ref}
        type="button"
        onClick={onExpand}
        aria-label={`${label}. Expand checklist`}
        aria-expanded={false}
        data-testid="getting-started-ring"
        className="relative flex flex-1 items-center gap-2.5 pr-2 transition-opacity hover:opacity-80"
      >
        <ProgressRing done={done} total={total} />
        <span className="text-sm font-semibold text-foreground">
          Get started
        </span>
        <span className="text-sm text-muted-foreground">
          {done}/{total}
        </span>
        <ChevronUp size={16} className="text-muted-foreground" />
        {unseen > 0 && (
          <Badge
            data-testid="getting-started-unseen"
            className="absolute -top-2 left-3 flex h-4 min-w-4 items-center justify-center rounded-full border-0 bg-accent px-1 text-[10px] font-bold text-white hover:bg-accent"
          >
            {unseen > 9 ? "9+" : unseen}
          </Badge>
        )}
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
