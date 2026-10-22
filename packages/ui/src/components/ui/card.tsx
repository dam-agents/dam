import { cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

export const CARD_SURFACE = "rounded-lg bg-card text-card-foreground border";

export const CARD_HOVER = "transition-colors hover:bg-muted/40";

export const cardSelectionVariants = cva(`${CARD_SURFACE} transition-colors`, {
  variants: {
    selected: {
      true: "border-foreground bg-muted/60",
      false: `border-border ${CARD_HOVER}`,
    },
  },
  defaultVariants: { selected: false },
});

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card" className={cn(CARD_SURFACE, className)} {...props} />
  );
}

export { Card };
