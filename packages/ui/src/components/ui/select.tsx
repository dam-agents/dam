import { ChevronDown } from "@carbon/icons-react";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const selectVariants = cva(
  "flex w-full cursor-pointer appearance-none rounded-md border bg-background pr-9 text-foreground ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        standard: "border-input",
        invalid: "border-destructive focus-visible:ring-destructive",
      },
      size: {
        default: "h-10 pl-4 py-2 text-sm",
        sm: "h-8 pl-3 text-[12px]",
        xs: "h-7 pl-3 text-[12px]",
      },
    },
    defaultVariants: {
      variant: "standard",
      size: "default",
    },
  },
);

const chevronSize: Record<NonNullable<SelectProps["size"]>, number> = {
  default: 16,
  sm: 14,
  xs: 14,
};

export interface SelectProps
  extends
    Omit<React.ComponentProps<"select">, "size">,
    VariantProps<typeof selectVariants> {}

function Select({ className, variant, size, ...props }: SelectProps) {
  return (
    <div className="relative w-full">
      <select
        className={cn(selectVariants({ variant, size, className }))}
        {...props}
      />
      <ChevronDown
        size={chevronSize[size ?? "default"]}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { Select, selectVariants };
