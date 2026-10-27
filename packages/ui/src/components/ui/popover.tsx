import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import {
  FLOATING_PANEL,
  FloatingPanelTail,
  TAIL_CORNER_CLEARANCE,
} from "@/components/ui/floating-panel";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;

function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  tail = true,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  tail?: boolean;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        arrowPadding={TAIL_CORNER_CLEARANCE}
        className={cn(FLOATING_PANEL, className)}
        {...props}
      >
        {children}
        {tail && (
          <PopoverPrimitive.Arrow asChild>
            <FloatingPanelTail />
          </PopoverPrimitive.Arrow>
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger };
