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
