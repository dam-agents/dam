import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      size: {
        default: "px-2.5 py-0.5 text-[12px] tracking-[0.338px]",
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
        warning:
          "border-transparent bg-warning/15 text-amber-700 dark:text-warning",
        danger: "border-transparent bg-danger-light text-danger",
        info: "border-transparent bg-info-light text-info",
        muted: "border-transparent bg-muted text-muted-foreground",
        accent: "border-transparent bg-accent-light text-accent",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

// span, not div: badges render inside phrasing content (buttons, inline rows).
function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
