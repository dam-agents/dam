import { ChevronDown } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The chevron every collapsible surface uses: down when open, rotated left
 *  when closed, animated between the two. */
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

/** Header button for a collapsible section. Owns the `aria-expanded` contract
 *  so call sites can't omit it; the container's look stays with the caller. */
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
