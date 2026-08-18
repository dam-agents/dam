import type { CarbonIconType } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { SelectableCard } from "./selectable-card.js";

export function CardIconTile({ icon: Icon }: { icon: CarbonIconType }) {
  return (
    <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
      <Icon className="size-5 text-muted-foreground" />
    </div>
  );
}

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  badge?: ReactNode;
  trailing?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}

export function StackedCard({
  icon,
  title,
  description,
  badge,
  trailing,
  selected,
  onSelect,
  testId,
}: Props) {
  return (
    <SelectableCard
      selected={selected}
      onSelect={onSelect}
      ariaLabel={title}
      testId={testId}
      className={
        selected ? undefined : "bg-gradient-to-br from-muted/60 to-transparent"
      }
    >
      <div className="flex min-h-[104px] flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          {icon}
          {trailing}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-foreground">{title}</p>
            {badge}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
    </SelectableCard>
  );
}
