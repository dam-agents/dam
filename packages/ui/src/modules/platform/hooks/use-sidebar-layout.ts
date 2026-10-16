import { useCallback, useRef, useState } from "react";

import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import { clampSidebarWidth, SIDEBAR_DEFAULT_W } from "../lib/sidebar-layout.js";

const SIDEBAR_WIDTH_KEY = "platform-sidebar-w";

export function useSidebarWidth() {
  const [width, setWidth] = useState(() =>
    clampSidebarWidth(
      readPersistedNumber(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_W),
    ),
  );
  const widthRef = useRef(width);
  const [resizing, setResizing] = useState(false);

  const resize = useCallback((delta: number) => {
    const next = clampSidebarWidth(widthRef.current + delta);
    widthRef.current = next;
    writePersistedNumber(SIDEBAR_WIDTH_KEY, next);
    setResizing(true);
    setWidth(next);
  }, []);

  const endResize = useCallback(() => setResizing(false), []);

  return { width, resizing, resize, endResize };
}
