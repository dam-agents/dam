import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import * as React from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-muted hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm font-medium",
        sm: "h-8 rounded-md px-3 text-sm font-normal",
        xs: "h-7 rounded-md px-2.5 text-xs font-medium",
        inline: "h-auto p-0",
        lg: "h-11 rounded-md px-8 text-sm font-medium",
        icon: "h-10 w-10 text-sm font-medium",
        "icon-sm": "h-7 w-7 text-sm font-medium",
        "icon-xs": "h-6 w-6 text-sm font-medium",
      },
      tone: {
        default: "",
        danger: "",
      },
    },
    compoundVariants: [
      {
        variant: "ghost",
        tone: "danger",
        className: "hover:bg-danger-light hover:text-danger",
      },
      {
        variant: "outline",
        tone: "danger",
        className:
          "hover:bg-danger-light hover:text-danger hover:border-danger",
      },
      {
        variant: "link",
        tone: "danger",
        className: "text-danger",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      tone: "default",
    },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  tooltip?: ReactNode;
}

function Button({
  className,
  variant,
  size,
  tone,
  asChild = false,
  tooltip,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const button = (
    <Comp
      className={cn(buttonVariants({ variant, size, tone, className }))}
      title={
        props.disabled && typeof tooltip === "string" ? tooltip : undefined
      }
      {...props}
    />
  );
  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
}

export { Button, buttonVariants };
