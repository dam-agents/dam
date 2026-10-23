import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const calloutVariants = cva("rounded-lg border", {
  variants: {
    tone: {
      default: "border-border",
      muted: "border-border bg-muted/40",
      gradient: "border-border bg-gradient-to-br from-muted/60 to-card",
      info: "border-callout-border bg-callout",
      warning: "border-warning bg-warning-light",
      danger: "border-danger bg-danger-light",
    },
    variant: {
      solid: "",
      dashed: "border-dashed",
    },
    size: {
      sm: "p-3",
      md: "p-4",
    },
  },
  defaultVariants: { tone: "default", variant: "solid", size: "md" },
});

export interface CalloutProps
  extends React.ComponentProps<"div">, VariantProps<typeof calloutVariants> {}

function Callout({ className, tone, variant, size, ...props }: CalloutProps) {
  return (
    <div
      data-slot="callout"
      className={cn(calloutVariants({ tone, variant, size }), className)}
      {...props}
    />
  );
}

export { Callout };
