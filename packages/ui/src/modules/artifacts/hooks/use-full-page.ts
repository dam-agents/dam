import { useCallback, useEffect, useState } from "react";

import { layerAbove } from "@/lib/layer-above";

export function useFullPage() {
  const [fullPage, setFullPage] = useState(false);

  useEffect(() => {
    if (!fullPage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || layerAbove()) return;
      setFullPage(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullPage]);

  const toggleFullPage = useCallback(() => setFullPage((on) => !on), []);
  return { fullPage, toggleFullPage };
}
