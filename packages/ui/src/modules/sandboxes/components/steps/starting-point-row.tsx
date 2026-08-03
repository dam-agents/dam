import type { CarbonIconType } from "@carbon/icons-react";

import { CardButton } from "@/components/ui/card-button";

import type { StartingPoint } from "../../lib/wizard-snapshot.js";

interface Props {
  startingPoint: StartingPoint;
  icon: CarbonIconType;
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
    <CardButton
      data-testid={`starting-point-${startingPoint}`}
      onClick={onSelect}
      selected={selected}
      className="flex w-full items-start gap-3.5 px-4 py-3.5"
    >
      <Icon size={22} className="mt-0.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-foreground leading-[1.2]">
          {name}
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      {tag && (
        <span className="shrink-0 text-xs text-muted-foreground">{tag}</span>
      )}
    </CardButton>
  );
}
