import { type RefObject, useEffect, useRef, useState } from "react";

import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import {
  shownSidePanelWidth,
  sidePanelMinWidth,
  type SidePanelTab,
} from "../lib/side-panel.js";

const SIDE_PANEL_WIDTH_KEY = "platform-file-w";
const SIDE_PANEL_BAR_W = 44;

export interface SidePanelLayout {
  setRowEl: (el: HTMLDivElement | null) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  minW: number;
  maxW: number | null;
  width: number | null;
  doesNotFit: boolean;
  resize: (delta: number) => void;
}

export function useSidePanelLayout(
  tab: SidePanelTab | null,
  contentMinW: number,
): SidePanelLayout {
  const [saved, setSaved] = useState<number | null>(() =>
    readPersistedNumber(SIDE_PANEL_WIDTH_KEY, null),
  );
  const savedRef = useRef(saved);
  const panelRef = useRef<HTMLDivElement>(null);
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [rowW, setRowW] = useState<number | null>(null);
  useEffect(() => {
    if (!rowEl) return;
    const ro = new ResizeObserver(([entry]) =>
      setRowW(entry.contentRect.width),
    );
    ro.observe(rowEl);
    return () => ro.disconnect();
  }, [rowEl]);

  const minW = sidePanelMinWidth(tab);
  const maxW = rowW === null ? null : rowW - contentMinW - SIDE_PANEL_BAR_W;
  return {
    setRowEl,
    panelRef,
    minW,
    maxW,
    width: saved === null ? null : shownSidePanelWidth(saved, minW, maxW),
    doesNotFit: rowW !== null && rowW < contentMinW + minW + SIDE_PANEL_BAR_W,
    resize: (delta) => {
      const max = maxW ?? window.innerWidth - 500;
      const base = shownSidePanelWidth(
        savedRef.current ?? panelRef.current?.offsetWidth ?? 0,
        minW,
        max,
      );
      const v = Math.max(minW, Math.min(max, base + delta));
      savedRef.current = v;
      writePersistedNumber(SIDE_PANEL_WIDTH_KEY, v);
      setSaved(v);
    },
  };
}
