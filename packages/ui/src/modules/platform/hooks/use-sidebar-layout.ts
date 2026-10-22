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

  const resize = useCallback(
    (delta: number) => {
      const { reached, width: next } = dragSidebarWidth(
        reachedRef.current ?? widthRef.current,
        delta,
      );
      reachedRef.current = reached;
      widthRef.current = next;
      writePersistedNumber(key, next);
      setResizing(true);
      setWidth(next);
    },
    [key],
  );

  const endResize = useCallback(() => {
    reachedRef.current = null;
    setResizing(false);
  }, []);

  return { width, resizing, resize, endResize };
}
