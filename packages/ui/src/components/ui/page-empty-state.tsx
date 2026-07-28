import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  title: string;
  message: ReactNode;
  actionLabel: string;
  actionIcon?: ReactNode;
  onAction: () => void;
}

/** The empty state for a whole page: a centered card with a heading, one line
 *  of copy, and a single primary action. Distinct from `EmptyStateCard`, which
 *  is the inline add-affordance used inside a populated sandbox section. */
export function PageEmptyState({
  title,
  message,
  actionLabel,
  actionIcon,
  onAction,
}: Props) {
  return (
    <Card className="flex flex-col items-center gap-3 border border-border px-6 py-12 text-center anim-in">
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      <p className="text-[14px] text-muted-foreground">{message}</p>
      <Button className="mt-1" onClick={onAction}>
        {actionIcon}
        {actionLabel}
      </Button>
    </Card>
  );
}
