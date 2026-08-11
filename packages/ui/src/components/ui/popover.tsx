import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;

/** Non-modal panel anchored to its trigger, with the tail pointing back at it.
 *  Unlike a dropdown menu this carries ordinary content — headings, prose,
 *  links — so it takes no menu semantics or arrow-key navigation. */
function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-overlay rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {/* A rotated square rather than Radix's triangle: pulled half over the
            panel's edge, it carries the border on its two outward sides and its
            filled half hides the segment of the panel border behind it — which
            a filled triangle sitting outside the edge cannot do. */}
        <PopoverPrimitive.Arrow asChild width={13} height={7}>
          <div className="h-[9px] w-[9px] -translate-y-1/2 rotate-45 border-b border-r border-border bg-popover" />
        </PopoverPrimitive.Arrow>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger };
