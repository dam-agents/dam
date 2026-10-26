import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ProgressRing } from "./progress-ring.js";

interface Props {
  done: number;
  total: number;
  unseen: number;
  expanded: boolean;
  onToggle: () => void;
}

export function ChecklistPill({
  done,
  total,
  unseen,
  expanded,
  onToggle,
}: Props) {
  const label = `Get started, ${String(done)} of ${String(total)} done${
    unseen > 0 ? `, ${String(unseen)} new avatar${unseen === 1 ? "" : "s"}` : ""
  }`;
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={expanded}
        data-testid="getting-started-ring"
        className={cn(
          "relative flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted",
          expanded && "bg-muted",
        )}
      >
        <ProgressRing done={done} total={total} />
        {unseen > 0 && (
          <Badge
            data-testid="getting-started-unseen"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border-0 bg-accent px-1 text-[10px] font-bold text-white hover:bg-accent"
          >
            {unseen > 9 ? "9+" : unseen}
          </Badge>
        )}
      </button>
    </Tooltip>
  );
}
