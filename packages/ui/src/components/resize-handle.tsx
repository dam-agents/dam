import { useCallback, useRef } from "react";

import { cn } from "@/lib/utils";

export function ResizeHandle({
  side = "left",
  orientation = "horizontal",
  onResize,
  onDragEnd,
}: {
  side?: "left" | "right";
  orientation?: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  onDragEnd?: () => void;
}) {
  const last = useRef(0);
  const vertical = orientation === "vertical";

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const handle = e.currentTarget;
      if (e.nativeEvent.isTrusted) handle.setPointerCapture(e.pointerId);
      last.current = vertical ? e.clientY : e.clientX;
      let dragging = true;

      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", endDrag);
        document.removeEventListener("pointercancel", endDrag);
        handle.removeEventListener("lostpointercapture", endDrag);
        window.removeEventListener("blur", endDrag);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onDragEnd?.();
      };

      const onPointerMove = (ev: PointerEvent) => {
        if ((ev.buttons & 1) === 0) {
          endDrag();
          return;
        }
        const pos = vertical ? ev.clientY : ev.clientX;
        const delta = pos - last.current;
        last.current = pos;
        onResize(vertical ? delta : side === "left" ? delta : -delta);
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
      handle.addEventListener("lostpointercapture", endDrag);
      window.addEventListener("blur", endDrag);
      document.body.style.cursor = vertical ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [side, vertical, onResize, onDragEnd],
  );

  if (vertical) {
    return (
      <div
        onPointerDown={onPointerDown}
        className="group relative z-raised -mt-[3px] -mb-[2px] h-[5px] shrink-0 cursor-row-resize flex items-center"
      >
        <div className="h-[2px] w-full bg-transparent group-hover:bg-foreground group-active:bg-foreground transition-colors" />
      </div>
    );
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "group relative z-raised w-[5px] shrink-0 cursor-col-resize flex justify-center",
        side === "left" ? "-ml-[3px]" : "-mr-[3px]",
      )}
    >
      <div className="w-[2px] h-full bg-transparent group-hover:bg-foreground group-active:bg-foreground transition-colors" />
    </div>
  );
}
