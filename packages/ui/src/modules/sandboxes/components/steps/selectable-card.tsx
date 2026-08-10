import type { ReactNode } from "react";

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
        "relative rounded-2xl border p-4 text-left transition-all",
        selected
          ? "border-foreground bg-muted/60 shadow-lg"
          : "border-border bg-gradient-to-br from-muted/60 to-card hover:shadow-lg",
        className,
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={ariaLabel}
        data-testid={testId}
        className="absolute inset-0 rounded-2xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="pointer-events-none relative">{children}</div>
    </div>
  );
}
