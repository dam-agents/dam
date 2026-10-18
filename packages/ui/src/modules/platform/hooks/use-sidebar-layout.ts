import { useCallback, useRef, useState } from "react";

import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import { clampSidebarWidth, SIDEBAR_DEFAULT_W } from "../lib/sidebar-layout.js";

const SIDEBAR_WIDTH_KEY = "platform-sidebar-w";

export function useSidebarWidth({
  key = SIDEBAR_WIDTH_KEY,
  fallback = SIDEBAR_DEFAULT_W,
}: { key?: string; fallback?: number } = {}) {
  const [width, setWidth] = useState(() =>
    clampSidebarWidth(readPersistedNumber(key, fallback)),
  );
  const widthRef = useRef(width);
  const [resizing, setResizing] = useState(false);

  const resize = useCallback(
    (delta: number) => {
      const next = clampSidebarWidth(widthRef.current + delta);
      widthRef.current = next;
      writePersistedNumber(key, next);
      setResizing(true);
      setWidth(next);
    },
    [key],
  );

  const endResize = useCallback(() => setResizing(false), []);

  return { width, resizing, resize, endResize };
}
