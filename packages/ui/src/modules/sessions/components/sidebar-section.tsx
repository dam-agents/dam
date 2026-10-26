import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useContext,
} from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

import { RightToolbarTiles } from "./right-toolbar-tiles.js";
import { SidePanelCloseButton } from "./side-panel-close-button.js";

export function SidebarSection({
  id,
  title,
  open,
  onToggle,
  headerRight,
  className,
  headerClassName,
  style,
  ref,
  children,
}: {
  id?: string;
  title: string;
  open: boolean;
  onToggle?: () => void;
  headerRight?: ReactNode;
  className?: string;
  headerClassName?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const tiles = useContext(RightToolbarTiles);
  return (
    <div
      id={id}
      className={cn("flex flex-col min-h-0 overflow-hidden", className)}
      style={style}
      ref={ref}
    >
      <div
        className={cn(
          "flex items-center gap-1 shrink-0 border-border",
          tiles ? "mt-2 h-10 pl-2 pr-2" : "h-12 pl-3 pr-2",
          open && "border-b",
          headerClassName,
          tiles && "border-t-0",
        )}
      >
        {onToggle ? (
          <DisclosureToggle
            open={open}
            onToggle={onToggle}
            chevronClassName="text-muted-foreground"
            className="flex-1 text-sm font-medium text-foreground transition-colors"
          >
            <span className="whitespace-nowrap">{title}</span>
          </DisclosureToggle>
        ) : (
          <h2 className="flex-1 whitespace-nowrap text-sm font-medium text-foreground">
            {title}
          </h2>
        )}
        {headerRight}
        <SidePanelCloseButton corner="-mt-2 -mr-2" />
      </div>
      {}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
