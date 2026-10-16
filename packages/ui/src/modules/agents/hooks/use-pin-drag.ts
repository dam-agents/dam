import {
  type DragEvent,
  type KeyboardEvent,
  useState,
  useSyncExternalStore,
} from "react";

import type { PinDrop } from "../lib/sidebar-pins.js";

let dragging: { scope: string; id: string } | null = null;
let shownScope: string | null = null;
const listeners = new Set<() => void>();

function showScope(scope: string | null) {
  shownScope = scope;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
}

function leftTarget(event: DragEvent<HTMLElement>): boolean {
  return !(
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget)
  );
}

function dropTarget(
  accepts: () => boolean,
  setOver: (over: boolean) => void,
  onDrop: (id: string, event: DragEvent<HTMLElement>) => void,
) {
  return {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!accepts()) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (leftTarget(event)) setOver(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      setOver(false);
      if (!accepts() || dragging === null) return;
      event.preventDefault();
      event.stopPropagation();
      onDrop(dragging.id, event);
    },
  };
}

export function usePinDragActive(scope: string): boolean {
  return useSyncExternalStore(subscribe, () => shownScope === scope);
}

export function usePinDropZone({
  scope,
  onMove,
}: {
  scope: string;
  onMove: (id: string, drop: PinDrop) => void;
}) {
  const [over, setOver] = useState(false);
  return {
    over,
    dropProps: dropTarget(
      () => dragging?.scope === scope,
      setOver,
      (id) => onMove(id, "top"),
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
  const [indicator, setIndicator] = useState<"before" | "after" | null>(null);
  const accepts = () =>
    pinned && dragging?.scope === scope && dragging.id !== id;
  const target = dropTarget(
    accepts,
    (over) => {
      if (!over) setIndicator(null);
    },
    (dragged, event) => onMove(dragged, { id, after: lowerHalf(event) }),
  );

  return {
    indicator,
    dragProps: {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        dragging = { scope, id };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        setTimeout(() => {
          if (dragging?.scope === scope && dragging.id === id) showScope(scope);
        });
      },
      ...target,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        target.onDragOver(event);
        if (event.defaultPrevented)
          setIndicator(lowerHalf(event) ? "after" : "before");
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
        dragging = null;
        showScope(null);
      },
    },
  };
}
