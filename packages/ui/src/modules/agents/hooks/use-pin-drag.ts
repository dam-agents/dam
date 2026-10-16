import { type DragEvent, useState } from "react";

import type { PinDrop } from "../lib/sidebar-pins.js";

let dragging: { scope: string; id: string; dropped: boolean } | null = null;

function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
}

// UNIT_BOUNDARY_DESCRIPTION: drag and drop for the sidebar's pinned order. A row only takes a drop from its own scope: Agents from the Agents list, Sessions from the same Agent's list. A drag pins what it carries: dropped on a row it lands before or after that row, dropped anywhere else it joins the end of the pinned rows.
export function usePinDrag({
  scope,
  id,
  onMove,
}: {
  scope: string;
  id: string;
  onMove: (id: string, drop: PinDrop | null) => void;
}) {
  const [indicator, setIndicator] = useState<"before" | "after" | null>(null);
  const accepts = () =>
    dragging !== null && dragging.scope === scope && dragging.id !== id;

  return {
    indicator,
    dragProps: {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        dragging = { scope, id, dropped: false };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!accepts()) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setIndicator(lowerHalf(event) ? "after" : "before");
      },
      onDragLeave: () => setIndicator(null),
      onDrop: (event: DragEvent<HTMLElement>) => {
        setIndicator(null);
        if (!accepts() || dragging === null) return;
        event.preventDefault();
        event.stopPropagation();
        dragging.dropped = true;
        onMove(dragging.id, { id, after: lowerHalf(event) });
      },
      onDragEnd: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        if (
          dragging?.scope === scope &&
          dragging.id === id &&
          !dragging.dropped
        )
          onMove(id, null);
        dragging = null;
      },
    },
  };
}
