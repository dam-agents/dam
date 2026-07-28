import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { StartingPoint } from "../../lib/wizard-snapshot.js";

interface Props {
  startingPoint: StartingPoint;
  icon: LucideIcon;
  name: string;
  description: string;
  /** Quiet trailing marker, e.g. "Advanced". */
  tag?: string;
  selected: boolean;
  onSelect: () => void;
}

export function StartingPointRow({
  startingPoint,
  icon: Icon,
  name,
  description,
  tag,
  selected,
  onSelect,
}: Props) {
  return (
    <button
      type="button"
      data-testid={`starting-point-${startingPoint}`}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3.5 rounded-lg border px-4 py-3.5 text-left transition-colors",
        selected
          ? "border-foreground bg-card"
          : "border-border bg-card hover:bg-muted/30",
      )}
    >
      <Icon
        size={22}
        strokeWidth={1.6}
        className="mt-0.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium text-foreground leading-[1.2]">
          {name}
        </span>
        <span className="mt-1 block text-[14px] text-muted-foreground">
          {description}
        </span>
      </span>
      {tag && (
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {tag}
        </span>
      )}
    </button>
  );
}
