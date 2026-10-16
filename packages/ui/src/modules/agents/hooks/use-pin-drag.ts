import { type DragEvent, type KeyboardEvent, useState } from "react";

import type { PinDrop } from "../lib/sidebar-pins.js";

let dragging: { scope: string; id: string; dropped: boolean } | null = null;

function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
}

// UNIT_BOUNDARY_DESCRIPTION: drag and drop for the sidebar's pinned order. A row only takes a drop from its own scope: Agents from the Agents list, Sessions from the same Agent's list. A drag pins what it carries: dropped on a row it lands before or after that row, dropped anywhere else it joins the end of the pinned rows. Alt+Up and Alt+Down do the same from the keyboard: Alt+Up pins a row or moves it up, Alt+Down moves it down, and past the last pinned row unpins it.
export function usePinDrag({
  scope,
  id,
  onMove,
  onStep,
}: {
  scope: string;
  id: string;
  onMove: (id: string, drop: PinDrop | null) => void;
  onStep: (id: string, step: -1 | 1) => void;
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
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!event.altKey) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        const focused = document.activeElement;
        onStep(id, event.key === "ArrowUp" ? -1 : 1);
        requestAnimationFrame(() => {
          if (
            focused instanceof HTMLElement &&
            focused !== document.activeElement
          )
            focused.focus();
        });
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
