import { type CSSProperties, useCallback, useRef, useState } from "react";

import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import {
  agentsSectionStyle,
  clampAgentsHeight,
  clampSidebarWidth,
  SIDEBAR_DEFAULT_W,
  storedAgentsHeight,
} from "../lib/sidebar-layout.js";

const SIDEBAR_WIDTH_KEY = "platform-sidebar-w";
const AGENTS_HEIGHT_KEY = "platform-sidebar-agents-h";

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

export function useSidebarSections() {
  const [agentsHeight, setAgentsHeight] = useState(() =>
    storedAgentsHeight(readPersistedNumber(AGENTS_HEIGHT_KEY, null)),
  );
  const heightRef = useRef(agentsHeight);
  const agentsRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);

  const drag = useRef<{ start: number; total: number; delta: number } | null>(
    null,
  );

  const resize = useCallback((delta: number) => {
    if (!drag.current) {
      const agentsPx = agentsRef.current?.getBoundingClientRect().height ?? 0;
      const activityPx =
        activityRef.current?.getBoundingClientRect().height ?? 0;
      drag.current = {
        start: Math.min(heightRef.current ?? agentsPx, agentsPx),
        total: agentsPx + activityPx,
        delta: 0,
      };
    }
    drag.current.delta += delta;
    const next = clampAgentsHeight(
      drag.current.start + drag.current.delta,
      drag.current.total,
    );
    heightRef.current = next;
    writePersistedNumber(AGENTS_HEIGHT_KEY, next);
    setAgentsHeight(next);
  }, []);

  const endResize = useCallback(() => {
    drag.current = null;
  }, []);

  const agentsStyle: CSSProperties = agentsSectionStyle(agentsHeight);

  return { agentsRef, activityRef, agentsStyle, resize, endResize };
}
