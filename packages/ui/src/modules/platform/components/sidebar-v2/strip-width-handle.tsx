import { useRef } from "react";

import { ResizeHandle } from "@/components/resize-handle";

import { useStore } from "../../../../store.js";
import { stripTravel, stripWidth } from "../../lib/agent-strip.js";

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
        const next = stripTravel(travel.current, delta, sidebarStripWide);
        travel.current = next.travel;
        if (next.flip) setSidebarStripWide(!sidebarStripWide);
      }}
      onDragEnd={() => {
        travel.current = 0;
      }}
    />
  );
}
