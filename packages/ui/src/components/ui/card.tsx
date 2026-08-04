import { cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/** The card surface, for elements that must be something other than a `div` —
 *  see `CardButton`. */
export const CARD_SURFACE = "rounded-lg bg-card text-card-foreground border";

/** Hover feedback for a clickable card. A background tint rather than a shadow:
 *  a dark-mode card sits on a near-identical background, so an elevation shadow
 *  reads as nothing there. `transition-colors` alone is the 150ms fade. */
export const CARD_HOVER = "transition-colors hover:bg-muted/40";

/** Surface for a card that represents a choice, picked or still pickable.
 *  Shared with the pickers that can't be a `CardButton`. */
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

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 p-6", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-2xl font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
  );
}

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
};
