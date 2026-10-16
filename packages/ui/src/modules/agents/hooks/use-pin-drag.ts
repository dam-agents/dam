import {
  type DragEvent,
  type KeyboardEvent,
  useSyncExternalStore,
} from "react";

import type { PinDrop } from "../lib/sidebar-pins.js";

interface PinDrag {
  scope: string;
  id: string;
  shown: boolean;
  over: PinDrop | null;
}

let drag: PinDrag | null = null;
const listeners = new Set<() => void>();

function update(next: PinDrag | null) {
  drag = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function usePinDragState<T>(read: (drag: PinDrag | null) => T): T {
  return useSyncExternalStore(subscribe, () => read(drag));
}

function sameDrop(a: PinDrop | null, b: PinDrop | null): boolean {
  if (a === "top" || b === "top" || a === null || b === null) return a === b;
  return a.id === b.id && a.after === b.after;
}

function hover(over: PinDrop | null) {
  if (drag && !sameDrop(drag.over, over)) update({ ...drag, over });
}

function hoverNothing() {
  hover(null);
}

function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
}

function dropTarget(
  scope: string,
  accepts: (dragged: string) => boolean,
  dropAt: (event: DragEvent<HTMLElement>) => PinDrop,
  onMove: (id: string, drop: PinDrop) => void,
) {
  const taken = (event: DragEvent<HTMLElement>) => {
    if (drag?.scope !== scope || !accepts(drag.id)) return null;
    event.preventDefault();
    event.stopPropagation();
    return drag;
  };
  return {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!taken(event)) return;
      event.dataTransfer.dropEffect = "move";
      hover(dropAt(event));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const dropped = taken(event);
      if (dropped) onMove(dropped.id, dropAt(event));
      hover(null);
    },
  };
}

export function usePinDropZone({
  scope,
  onMove,
}: {
  scope: string;
  onMove: (id: string, drop: PinDrop) => void;
}) {
  const shown = usePinDragState((d) => d?.scope === scope && d.shown);
  const over = usePinDragState((d) => d?.scope === scope && d.over === "top");
  return {
    shown,
    over,
    dropProps: dropTarget(
      scope,
      () => true,
      () => "top",
      onMove,
    ),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: drag and drop for the sidebar's pinned order. A row only takes a drop from its own scope: Agents from the Agents list, Sessions from the same Agent's list. Only pinned rows take a drop, and a drop there moves the item before or after that row and pins it. With nothing pinned yet, the "Drop to pin" area at the top of the list takes the drop instead. A drop anywhere else cancels the drag: nothing moves and nothing is pinned. Alt+Up and Alt+Down reorder from the keyboard: Alt+Up pins a row or moves it up, Alt+Down moves it down, and past the last pinned row unpins it.
export function usePinDrag({
  scope,
  id,
  pinned,
  onMove,
  onStep,
}: {
  scope: string;
  id: string;
  pinned: boolean;
  onMove: (id: string, drop: PinDrop) => void;
  onStep: (id: string, step: -1 | 1) => void;
}) {
  const indicator = usePinDragState((d): "before" | "after" | null => {
    const over = d?.scope === scope ? d.over : null;
    if (over === null || over === "top" || over.id !== id) return null;
    return over.after ? "after" : "before";
  });

  return {
    indicator,
    dragProps: {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        update({ scope, id, shown: false, over: null });
        document.addEventListener("dragover", hoverNothing);
        setTimeout(() => {
          if (drag?.scope === scope && drag.id === id)
            update({ ...drag, shown: true });
        });
      },
      ...dropTarget(
        scope,
        (dragged) => pinned && dragged !== id,
        (event) => ({ id, after: lowerHalf(event) }),
        onMove,
      ),
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
        document.removeEventListener("dragover", hoverNothing);
        update(null);
      },
    },
  };
}
