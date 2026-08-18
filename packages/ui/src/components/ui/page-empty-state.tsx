import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

interface Props {
  title: string;
  message: ReactNode;
  actionLabel: string;
  actionIcon?: ReactNode;
  onAction: () => void;
}

export function PageEmptyState({
  title,
  message,
  actionLabel,
  actionIcon,
  onAction,
}: Props) {
  return (
    <Callout
      tone="gradient"
      className="flex flex-col items-start gap-3 p-6 anim-in"
    >
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="max-w-[520px] text-sm text-muted-foreground">{message}</p>
      <Button className="mt-1" onClick={onAction}>
        {actionIcon}
        {actionLabel}
      </Button>
    </Callout>
  );
}
