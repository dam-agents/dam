import { type RefObject, useCallback, useEffect } from "react";

import { useFocusTrap } from "@/components/modal";
import { layerAbove } from "@/lib/layer-above";

import { useStore } from "../../../store.js";

const tooltipOpen = () => document.querySelector('[role="tooltip"]') !== null;

export function useFullPage(containerRef: RefObject<HTMLElement | null>) {
  const fullPage = useStore((s) => s.artifactFullPage);
  const setFullPage = useStore((s) => s.setArtifactFullPage);
  useFocusTrap(containerRef, fullPage);

  useEffect(() => {
    if (!fullPage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (layerAbove() || tooltipOpen()) return;
      e.preventDefault();
      setFullPage(false);
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [fullPage, setFullPage]);

  useEffect(() => () => setFullPage(false), [setFullPage]);

  const toggleFullPage = useCallback(
    () => setFullPage(!fullPage),
    [fullPage, setFullPage],
  );
  return { fullPage, toggleFullPage };
}
