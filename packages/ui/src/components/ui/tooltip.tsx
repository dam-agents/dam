import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import * as React from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-tooltip overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: React.ComponentPropsWithoutRef<
    typeof TooltipPrimitive.Content
  >["side"];
  className?: string;
}

/** A hint on something that is already interactive: the child becomes the
 *  trigger, so it keeps its own focus, click and ref. Use this instead of the
 *  native `title` attribute, which neither keyboard nor touch can reach.
 *
 *  The content is announced as a description, not as a name — an icon-only
 *  trigger still needs its own `aria-label`. */
function Tooltip({
  children,
  content,
  side = "bottom",
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent
        side={side}
        className={cn("max-w-xs text-xs leading-relaxed", className)}
      >
        {content}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}

interface HintTooltipProps extends Omit<TooltipProps, "className"> {
  /** Names the trigger, since the hint itself is only its description. */
  label: string;
  /** Classes for the focusable wrapper, not for the tooltip. */
  className?: string;
}

/** A hint hung off something inert — a status dot, a badge, a warning glyph.
 *  Wrapping it in a button is what makes the hint reachable at all: a bare
 *  span takes neither focus nor tap. */
function HintTooltip({
  children,
  label,
  className,
  ...props
}: HintTooltipProps) {
  return (
    <Tooltip {...props}>
      <button
        type="button"
        aria-label={label}
        className={cn("inline-flex cursor-help items-center", className)}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export { HintTooltip, Tooltip, TooltipContent, TooltipProvider };
