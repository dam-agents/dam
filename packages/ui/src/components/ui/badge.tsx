import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      size: {
        default: "px-2.5 py-0.5 text-xs tracking-[0.338px]",
        sm: "px-1.5 py-0.5 text-[10px] font-medium",
      },
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-success-light text-green-700 dark:text-success",
        warning: "border-transparent bg-warning/15 text-warning-fg",
        danger: "border-transparent bg-danger-light text-danger",
        info: "border-transparent bg-info-light text-info",
        muted: "border-transparent bg-muted text-muted-foreground",
        accent: "border-transparent bg-accent-light text-accent",
        template: "border-transparent bg-template-light text-template",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
