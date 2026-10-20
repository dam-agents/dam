import { useCallback, useRef } from "react";

import { cn } from "@/lib/utils";

const KEY_STEP: Record<string, number> = {
  ArrowLeft: -16,
  ArrowRight: 16,
  ArrowUp: -16,
  ArrowDown: 16,
};
const VERTICAL_KEYS = new Set(["ArrowUp", "ArrowDown"]);

export function ResizeHandle({
  side = "left",
  orientation = "horizontal",
  onResize,
  onDragEnd,
  label = "Resize",
  value,
}: {
  side?: "left" | "right";
  orientation?: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  onDragEnd?: () => void;
  label?: string;
  value?: number;
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEP[e.key];
    if (step === undefined || vertical !== VERTICAL_KEYS.has(e.key)) return;
    e.preventDefault();
    onResize(vertical || side === "left" ? step : -step);
    onDragEnd?.();
  };

  const a11y = {
    role: "separator",
    tabIndex: 0,
    "aria-label": label,
    "aria-orientation": vertical ? "horizontal" : "vertical",
    "aria-valuenow": value,
    onPointerDown,
    onKeyDown,
  } as const;
  const line =
    "bg-transparent group-hover:bg-foreground group-active:bg-foreground group-focus-visible:bg-ring transition-colors";

  if (vertical) {
    return (
      <div
        {...a11y}
        className="group relative z-raised -mt-[3px] -mb-[2px] h-[5px] shrink-0 cursor-row-resize flex items-center outline-none"
      >
        <div className={cn("h-[2px] w-full", line)} />
      </div>
    );
  }

  return (
    <div
      {...a11y}
      className={cn(
        "group relative z-raised w-[5px] shrink-0 cursor-col-resize flex justify-center outline-none",
        side === "left" ? "-ml-px" : "-mr-px",
      )}
    >
      <div className={cn("w-[2px] h-full", line)} />
    </div>
  );
}
