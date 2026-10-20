import { useRef } from "react";

import { ResizeHandle } from "@/components/resize-handle";

import { useStore } from "../../../../store.js";
import { STRIP_SNAP_PX, stripWidth } from "../../lib/agent-strip.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The edge between the agent strip and the
 * conversation column. The strip has two fixed widths, so a short drag or an
 * arrow key flips it to the other one at once instead of following the pointer.
 */
export function StripWidthHandle() {
  const wide = useStore((s) => s.sidebarStripWide);
  const travel = useRef(0);
  return (
    <ResizeHandle
      side="left"
      label="Agent strip width"
      value={stripWidth(wide)}
      onResize={(delta) => {
        const { sidebarStripWide, setSidebarStripWide } = useStore.getState();
        travel.current = sidebarStripWide
          ? Math.min(0, travel.current + delta)
          : Math.max(0, travel.current + delta);
        if (Math.abs(travel.current) < STRIP_SNAP_PX) return;
        travel.current = 0;
        setSidebarStripWide(!sidebarStripWide);
      }}
      onDragEnd={() => {
        travel.current = 0;
      }}
    />
  );
}
