import { type RefObject, useEffect, useState } from "react";

// UNIT_BOUNDARY_DESCRIPTION: the pane animates its width for this long, so a swap that waits for the end of the animation gives up waiting a little after it.
const WIDTH_MS = 200;
const FALLBACK_MS = WIDTH_MS + 50;

// UNIT_BOUNDARY_DESCRIPTION: which of the pane's two contents it shows lags the width it is heading for, so a collapse keeps the tree on screen, clipped by the narrowing pane, until the width has finished moving and only then swaps to the rail; an expand shows the tree at once and lets the width catch up. Any other reason for the width to change, a drag, a window too narrow for a pane, or a reader who asked for no motion, swaps at once.
export function useCollapseContent({
  expanded,
  animated,
  target,
}: {
  expanded: boolean;
  animated: boolean;
  target: RefObject<HTMLElement | null>;
}) {
  const [lagging, setLagging] = useState(false);

  useEffect(() => {
    if (expanded) setLagging(false);
  }, [expanded]);

  useEffect(() => {
    const el = target.current;
    if (!lagging || !el) return;
    const onEnd = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === "width") {
        setLagging(false);
      }
    };
    el.addEventListener("transitionend", onEnd);
    // UNIT_BOUNDARY_DESCRIPTION: a pane already at its width animates nothing and ends nothing, so the swap cannot wait on that event alone.
    const timer = setTimeout(() => setLagging(false), FALLBACK_MS);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
    };
  }, [lagging, target]);

  return {
    contentExpanded: expanded || lagging,
    lagging,
    collapse: () => setLagging(animated),
  };
}
