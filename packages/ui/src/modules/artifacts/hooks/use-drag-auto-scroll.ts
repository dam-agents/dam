import { useEffect, useMemo, useRef } from "react";

import { startDragAutoScroll } from "../lib/drag-auto-scroll.js";

export function useDragAutoScroll() {
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  return useMemo(
    () => ({
      start: (source: Element) => {
        stopRef.current?.();
        stopRef.current = startDragAutoScroll(source);
      },
      stop: () => {
        stopRef.current?.();
        stopRef.current = null;
      },
    }),
    [],
  );
}
