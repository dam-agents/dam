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
  // Signed delta: horizontal → rightward positive for side="left"; vertical → downward positive.
  onResize: (delta: number) => void;
  onDragEnd?: () => void;
}) {
  const dragging = useRef(false);
  const last = useRef(0);
  const vertical = orientation === "vertical";

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      last.current = vertical ? e.clientY : e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const pos = vertical ? ev.clientY : ev.clientX;
        const delta = pos - last.current;
        last.current = pos;
        onResize(vertical ? delta : side === "left" ? delta : -delta);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onDragEnd?.();
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = vertical ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [side, vertical, onResize, onDragEnd],
  );

  if (vertical) {
    return (
      <div
        onMouseDown={onMouseDown}
        className="group relative z-raised -mt-[3px] -mb-[2px] h-[5px] shrink-0 cursor-row-resize flex items-center"
      >
        <div className="h-[2px] w-full bg-transparent group-hover:bg-text group-active:bg-text transition-colors" />
      </div>
    );
  }

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "group relative z-raised w-[5px] shrink-0 cursor-col-resize flex justify-center",
        side === "left" ? "-ml-[3px]" : "-mr-[3px]",
      )}
    >
      <div className="w-[2px] h-full bg-transparent group-hover:bg-text group-active:bg-text transition-colors" />
    </div>
  );
}
