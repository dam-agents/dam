import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const textareaVariants = cva(
  "flex min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        standard: "border-input",
        monospace: "border-input font-mono",
        invalid: "border-destructive focus-visible:ring-destructive",
      },
    },
    defaultVariants: {
      variant: "standard",
    },
  },
);

export interface TextareaProps
  extends
    React.ComponentProps<"textarea">,
    VariantProps<typeof textareaVariants> {}

function Textarea({ className, variant, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(textareaVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Textarea, textareaVariants };
