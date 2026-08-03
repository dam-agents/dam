import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SelectableCard({
  selected,
  onSelect,
  ariaLabel,
  testId,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  ariaLabel: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg border p-4 transition-colors",
        selected
          ? "border-foreground bg-muted/60"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      {/* Stretched overlay so a nested link can sit above it, which a real <button> can't wrap. */}
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
