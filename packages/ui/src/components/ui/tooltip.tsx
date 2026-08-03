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

/** Announced as a description, not a name — an icon-only trigger still needs
 *  its own `aria-label`. */
function Tooltip({
  children,
  content,
  side = "bottom",
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      {/* Radix opens on any focus, so restoring focus to a trigger — what a
          menu or dialog does when it closes — would leave a tooltip stuck open
          away from the pointer. preventDefault here suppresses only Radix's
          own handler. */}
      <TooltipPrimitive.Trigger
        asChild
        onFocus={(event) => {
          if (!event.currentTarget.matches(":focus-visible"))
            event.preventDefault();
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
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
  label: string;
  /** Classes for the focusable wrapper, not for the tooltip. */
  className?: string;
}

/** For an inert child. The button does nothing but take focus, which a bare
 *  span can't. */
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
