import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import {
  FLOATING_PANEL,
  FloatingPanelTail,
} from "@/components/ui/floating-panel";
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
        className={cn(FLOATING_PANEL, className)}
        {...props}
      >
        {children}
        <PopoverPrimitive.Arrow asChild>
          <FloatingPanelTail />
        </PopoverPrimitive.Arrow>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger };
