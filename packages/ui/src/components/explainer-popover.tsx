import { Help } from "@carbon/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const HOVER_CLOSE_DELAY_MS = 120;

export function ExplainerPopover({
  label,
  side = "top",
  align = "start",
  className,
  children,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={label}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground",
          "hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <Help size={16} />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[360px] max-w-[calc(100vw-2rem)] p-4 text-sm"
      >
        <div className="flex flex-col gap-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
