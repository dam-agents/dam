import { useCallback, useRef, useState } from "react";

import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import {
  clampSidebarWidth,
  dragSidebarWidth,
  SIDEBAR_DEFAULT_W,
} from "../lib/sidebar-layout.js";

const SIDEBAR_WIDTH_KEY = "platform-sidebar-w";

export function useSidebarWidth({
  key = SIDEBAR_WIDTH_KEY,
  fallback = SIDEBAR_DEFAULT_W,
}: { key?: string; fallback?: number } = {}) {
  const [width, setWidth] = useState(() =>
    clampSidebarWidth(readPersistedNumber(key, fallback)),
  );
  const widthRef = useRef(width);
  const reachedRef = useRef<number | null>(null);
  const [resizing, setResizing] = useState(false);

  const setWidthTo = useCallback((next: number, max?: number) => {
    const clamped = clampSidebarWidth(next, max);
    widthRef.current = clamped;
    setResizing(true);
    setWidth(clamped);
  }, []);

  const resize = useCallback(
    (delta: number, max?: number) => {
      const { reached, width: next } = dragSidebarWidth(
        reachedRef.current ?? widthRef.current,
        delta,
      );
      reachedRef.current = reached;
      setWidthTo(next, max);
    },
    [setWidthTo],
  );

  // UNIT_BOUNDARY_DESCRIPTION: a drag writes the width it ends on once, rather than on every pointer move, so the pane follows the pointer without a storage write on the way.
  const endResize = useCallback(() => {
    reachedRef.current = null;
    writePersistedNumber(key, widthRef.current);
    setResizing(false);
  }, [key]);

  return { width, resizing, resize, setWidthTo, endResize };
}
