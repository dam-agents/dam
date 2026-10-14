import type { CarbonIconType } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { SIDEBAR_ITEM, sidebarItemTone } from "./sidebar-nav-item.js";

interface Props {
  label: string;
  icon: CarbonIconType;
  badge?: boolean;
  children: (close: () => void) => ReactNode;
}

export function SidebarFlyout({ label, icon: Icon, badge, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={label} side="right">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(SIDEBAR_ITEM, "relative", sidebarItemTone(open))}
          >
            <Icon size={16} />
            {badge && (
              <span className="absolute top-1.5 left-6 size-2 rounded-full border-[1.5px] border-card bg-accent" />
            )}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        className="flex max-h-[min(70vh,560px)] w-[280px] flex-col p-2"
      >
        <div className="min-h-0 overflow-y-auto">
          {children(() => setOpen(false))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
