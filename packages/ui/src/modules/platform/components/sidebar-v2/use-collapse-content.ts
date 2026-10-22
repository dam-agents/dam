import { type RefObject, useEffect, useRef, useState } from "react";

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
  const [moving, setMoving] = useState<"collapse" | "expand" | null>(null);
  // UNIT_BOUNDARY_DESCRIPTION: an expand is the width catching up with the content already drawn, so it is read from the width itself; a collapse the user did not ask for, a drag or a window too narrow for the pane, must swap at once and so is only ever started by collapse().
  const wasExpanded = useRef(expanded);

  useEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    if (expanded) setMoving(animated ? "expand" : null);
  }, [expanded, animated]);

  useEffect(() => {
    const el = target.current;
    if (!moving || !el) return;
    const onEnd = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === "width") {
        setMoving(null);
      }
    };
    el.addEventListener("transitionend", onEnd);
    // UNIT_BOUNDARY_DESCRIPTION: a pane already at its width animates nothing and ends nothing, so the swap cannot wait on that event alone.
    const timer = setTimeout(() => setMoving(null), FALLBACK_MS);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
    };
  }, [moving, target]);

  // UNIT_BOUNDARY_DESCRIPTION: the pane's width is animated by CSS, where a stylesheet cannot read it, so a label that must end in an ellipsis at the pane's edge reads the width this writes on every frame of the animation and drops it after.
  useEffect(() => {
    const el = target.current;
    if (!moving || !el) return;
    let frame = 0;
    const tick = () => {
      el.style.setProperty("--sidebar-w", `${el.clientWidth}px`);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      el.style.removeProperty("--sidebar-w");
    };
  }, [moving, target]);

  return {
    contentExpanded: expanded || moving === "collapse",
    // UNIT_BOUNDARY_DESCRIPTION: while the width moves, the content keeps the width it had, so the pane uncovers it rather than squeezing it; only a drag resizes what is inside.
    moving: moving !== null,
    collapse: () => setMoving(animated ? "collapse" : null),
  };
}
