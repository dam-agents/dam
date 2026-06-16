import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Vertical stack of selectable cards/rows under a WizardSectionLabel. The
 * desktop-only negative left margin (matched to the cards' p-4) bleeds the card
 * surface leftward so the card *content* lines up with the section label, while
 * the right edge stays on the content column so trailing action buttons still
 * align with the cards. Disabled on mobile, where the gutter can't absorb it.
 */
export function CardList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:-ml-4", className)}>
      {children}
    </div>
  );
}
