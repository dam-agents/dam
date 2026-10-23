import type { ReactNode } from "react";

import { cardSelectionVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SelectableCard({
  selected,
  onSelect,
  ariaLabel,
  testId,
  className,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  ariaLabel: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        cardSelectionVariants({ selected }),
        "relative p-4",
        className,
      )}
    >
      {}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={ariaLabel}
        data-testid={testId}
        className="absolute inset-0 rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="pointer-events-none relative">{children}</div>
    </div>
  );
}
