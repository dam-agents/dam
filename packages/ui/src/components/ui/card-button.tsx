import type { VariantProps } from "class-variance-authority";
import * as React from "react";

import { cardSelectionVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CardButtonProps
  extends
    React.ComponentProps<"button">,
    VariantProps<typeof cardSelectionVariants> {}

export function CardButton({ className, selected, ...props }: CardButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? undefined}
      className={cn(
        cardSelectionVariants({ selected }),
        "text-left ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
