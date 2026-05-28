import { useCallback, useRef } from "react";

export function ResizeHandle({
  side,
  onResize,
}: {
  side: "left" | "right";
  onResize: (delta: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        onResize(side === "left" ? delta : -delta);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [side, onResize],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-[5px] shrink-0 cursor-col-resize hover:bg-accent/20 active:bg-accent/30 transition-colors"
      style={{
        marginLeft: side === "left" ? -3 : 0,
        marginRight: side === "right" ? -3 : 0,
        position: "relative",
        zIndex: 20,
      }}
    />
  );
}
