import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const cardButtonVariants = cva(
  `${CARD_SURFACE} text-left ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50`,
  {
    variants: {
      selected: {
        true: "border-foreground",
        false: `border-border ${CARD_HOVER}`,
      },
    },
    defaultVariants: { selected: false },
  },
);

interface CardButtonProps
  extends
    React.ComponentProps<"button">,
    VariantProps<typeof cardButtonVariants> {}

/** A whole card that acts as one button — a pickable option, a "connect this"
 *  affordance. Callers supply the inner layout through `className`. */
export function CardButton({ className, selected, ...props }: CardButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? undefined}
      className={cn(cardButtonVariants({ selected }), className)}
      {...props}
    />
  );
}
