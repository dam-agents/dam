import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { FIELD_INSET } from "@/components/ui/inset";
import { cn } from "@/lib/utils";

const calloutVariants = cva("rounded-lg border", {
  variants: {
    tone: {
      default: "border-border",
      muted: "border-border bg-muted/40",
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
  extends React.ComponentProps<"div">, VariantProps<typeof calloutVariants> {
  inset?: boolean;
}

/** The one bordered box: hints, notices, alerts, and form groups all render
 *  through it so radius, border weight, padding, and background stop drifting
 *  per call site. A dumb container — children own their own anatomy.
 *
 *  `inset` is off by default (unlike `FormField`'s): most call sites live in
 *  gutter-less containers where the outdent would push the box onto the
 *  container's border. */
function Callout({
  className,
  tone,
  variant,
  size,
  inset,
  ...props
}: CalloutProps) {
  return (
    <div
      data-slot="callout"
      className={cn(
        calloutVariants({ tone, variant, size }),
        inset && FIELD_INSET,
        className,
      )}
      {...props}
    />
  );
}

export { Callout, calloutVariants };
