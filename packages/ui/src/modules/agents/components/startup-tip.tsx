import { Idea } from "@carbon/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { startupTips } from "../startup-tips.js";

/** Time a tip stays put, measured start-of-transition to start-of-transition. */
const ROTATE_MS = 8_000;
/** Each direction of the swap. The text is replaced while the card is at zero
 *  opacity, so the outgoing and incoming tips never share the screen — two
 *  different sentences at partial opacity is unreadable in a way that two
 *  fading images is not. */
const FADE_MS = 250;
/** The spinner, the sandbox name and its badge should land first; the tip
 *  arrives after them rather than competing for the same first glance. */
const ENTER_DELAY_MS = 1_000;

/** A tip other than `current`, so the rotation never appears to stall on a
 *  repeat. Random rather than sequential: the same sandbox gets restarted a
 *  lot, and a fixed order turns into one memorized loop. */
function pickNext(current: number, count: number): number {
  if (count < 2) return current;
  return (current + 1 + Math.floor(Math.random() * (count - 1))) % count;
}

/**
 * Rotating tips for every wait that shows a spinner. Two jobs: teach the
 * feature set to someone whose first minutes would otherwise be spent on a
 * static screen, and let the movement itself be the evidence that the wait
 * hasn't stalled.
 *
 * Read-only text on purpose — a link would pull the user off the screen
 * mid-wait, and they came to use the sandbox, not to read docs.
 */
export function StartupTip() {
  const tips = useMemo(startupTips, []);
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * tips.length),
  );
  const [shown, setShown] = useState(false);
  // The rotation reads the live index without listing it as a dependency —
  // otherwise every swap would tear down and restart the timer, and each tip
  // would get its full dwell only by accident. Nothing else may enter these
  // deps either: anything that changes mid-wait restarts the countdown, which
  // is what a hover-to-pause flag did before it was removed.
  const indexRef = useRef(index);
  const swapRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const enter = setTimeout(() => setShown(true), ENTER_DELAY_MS);
    // Rotation is clocked from the end of the entrance, so the first tip gets
    // the same dwell as every one after it.
    let rotate: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      if (tips.length < 2) return;
      rotate = setInterval(() => {
        setShown(false);
        swapRef.current = setTimeout(() => {
          indexRef.current = pickNext(indexRef.current, tips.length);
          setIndex(indexRef.current);
          setShown(true);
        }, FADE_MS);
      }, ROTATE_MS);
    }, ENTER_DELAY_MS + FADE_MS);

    return () => {
      clearTimeout(enter);
      clearTimeout(start);
      clearTimeout(swapRef.current);
      clearInterval(rotate);
    };
  }, [tips.length]);

  // 480px holds every tip in two lines at the length budget `startupTips`
  // keeps to. A tip that outgrows it wraps to three and shoves the centered
  // column up mid-wait, so the budget is the thing to preserve, not this width.
  //
  // The card carries the opacity, not the text inside it: fading the whole box
  // keeps its border and the icon tile in step with the words. It stays mounted
  // throughout, so the layout beneath never moves.
  return (
    <Callout
      className={cn(
        "flex w-full max-w-120 min-h-22 items-start gap-3 p-5 text-left motion-safe:transition-opacity",
        // Reduced motion skips the fades and the entrance entirely.
        shown ? "opacity-100" : "opacity-0 motion-reduce:opacity-100",
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Idea size={16} className="text-muted-foreground" />
      </span>
      <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
        {tips[index]}
      </p>
    </Callout>
  );
}
