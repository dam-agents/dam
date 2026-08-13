import { ChevronDown } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DisclosureChevron({
  open,
  size = 16,
  className,
}: {
  open: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <ChevronDown
      size={size}
      aria-hidden
      className={cn(
        "shrink-0 transition-transform",
        !open && "-rotate-90",
        className,
      )}
    />
  );
}

export function DisclosureToggle({
  open,
  onToggle,
  chevronSize,
  chevronClassName,
  testId,
  className,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  chevronSize?: number;
  chevronClassName?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-testid={testId}
      className={cn("flex items-center gap-2 text-left", className)}
    >
      <DisclosureChevron
        open={open}
        size={chevronSize}
        className={chevronClassName}
      />
      {children}
    </button>
  );
}
