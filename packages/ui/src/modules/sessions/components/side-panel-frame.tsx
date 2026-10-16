import { ArrowLeft } from "@carbon/icons-react";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ResizeHandle } from "../../../components/resize-handle.js";
import type { SidePanelLayout } from "../hooks/use-side-panel-layout.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The side panel beside a page, with its resize
 * handle and its icon bar. Every page that has the icon bar hosts its panels
 * in this frame, so they open, resize and narrow the page the same way. On a
 * phone an open panel fills the screen under a back button.
 */
export function SidePanelFrame({
  layout,
  open,
  fills,
  keepMounted = false,
  mobileOpen,
  mobileTitle,
  onMobileBack,
  edge,
  bar,
  children,
}: {
  layout: SidePanelLayout;
  open: boolean;
  fills: boolean;
  keepMounted?: boolean;
  mobileOpen: boolean;
  mobileTitle: ReactNode;
  onMobileBack: () => void;
  edge?: ReactNode;
  bar: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {open && !fills && (
        <div className="hidden md:flex">
          <ResizeHandle side="right" onResize={layout.resize} />
        </div>
      )}
      <div
        data-testid="side-panel"
        className={cn(
          "flex bg-background relative z-content max-md:fixed max-md:inset-0 max-md:z-overlay",
          !mobileOpen && "max-md:hidden",
          fills
            ? "md:flex-1 md:min-w-0"
            : open && layout.width === null
              ? "md:flex-1 md:basis-0 md:min-w-0"
              : "md:shrink-0",
        )}
      >
        {(open || keepMounted) && (
          <div
            ref={layout.panelRef}
            style={
              {
                "--file-min-w": `${layout.minW}px`,
                ...(layout.width !== null && {
                  "--file-w": `${layout.width}px`,
                }),
              } as CSSProperties
            }
            className={cn(
              "flex flex-col min-w-0 overflow-hidden max-md:flex-1",
              !fills && "md:min-w-[var(--file-min-w)]",
              !open && "hidden",
              fills || layout.width === null
                ? "md:flex-1"
                : "md:shrink-0 md:w-[var(--file-w)]",
              "md:border-l md:border-border",
            )}
          >
            <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                onClick={onMobileBack}
              >
                <ArrowLeft size={16} />
              </Button>
              <span className="truncate text-sm font-bold text-foreground">
                {mobileTitle}
              </span>
            </div>
            {children}
          </div>
        )}
        {edge}
        {bar}
      </div>
    </>
  );
}
