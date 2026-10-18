import {
  type DragEvent,
  type KeyboardEvent,
  useSyncExternalStore,
} from "react";

import type { OrderDrop } from "../lib/sidebar-order.js";

interface OrderDrag {
  scope: string;
  id: string;
  over: OrderDrop | null;
}

let drag: OrderDrag | null = null;
const listeners = new Set<() => void>();

function update(next: OrderDrag | null) {
  drag = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function hover(over: OrderDrop | null) {
  if (!drag) return;
  const same =
    drag.over === over ||
    (drag.over !== null &&
      over !== null &&
      drag.over.id === over.id &&
      drag.over.after === over.after);
  if (!same) update({ ...drag, over });
}

function hoverNothing() {
  hover(null);
}

function endDrag() {
  document.removeEventListener("dragover", hoverNothing);
  document.removeEventListener("dragend", endDrag, true);
  document.removeEventListener("drop", endAfterDrop, true);
  document.removeEventListener("pointermove", endDrag, true);
  update(null);
}

function endAfterDrop() {
  setTimeout(endDrag);
}

function startDrag(scope: string, id: string) {
  endDrag();
  update({ scope, id, over: null });
  document.addEventListener("dragover", hoverNothing);
  document.addEventListener("dragend", endDrag, true);
  document.addEventListener("drop", endAfterDrop, true);
  document.addEventListener("pointermove", endDrag, true);
}

function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
}

// UNIT_BOUNDARY_DESCRIPTION: drag and drop, and Alt+Up and Alt+Down, for the sidebar's manual order. Rows drag only once the stored order has loaded, since a move edits it. A row only takes a drop from its own scope, the Agents list, so a drag from anywhere else moves nothing. A drop on a row puts the dragged item before or after it, by the half of the row the pointer is in. Alt+Up and Alt+Down move the focused row one place. The drag ends on the document's dragend, drop or next pointer move, so it also ends when the row it started on is gone.
export function useOrderDrag({
  scope,
  id,
  ready,
  onMove,
  onStep,
}: {
  scope: string;
  id: string;
  ready: boolean;
  onMove: (id: string, drop: OrderDrop) => void;
  onStep: (id: string, step: -1 | 1) => void;
}) {
  const indicator = useSyncExternalStore(
    subscribe,
    (): "before" | "after" | null => {
      const over = drag?.scope === scope ? drag.over : null;
      if (over === null || over.id !== id) return null;
      return over.after ? "after" : "before";
    },
  );
  const taken = (event: DragEvent<HTMLElement>) => {
    if (drag?.scope !== scope || drag.id === id) return null;
    event.preventDefault();
    event.stopPropagation();
    return drag;
  };

  return {
    indicator,
    dragProps: {
      draggable: ready,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        startDrag(scope, id);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!taken(event)) return;
        event.dataTransfer.dropEffect = "move";
        hover({ id, after: lowerHalf(event) });
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const dropped = taken(event);
        if (dropped) onMove(dropped.id, { id, after: lowerHalf(event) });
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
    },
  };
}
