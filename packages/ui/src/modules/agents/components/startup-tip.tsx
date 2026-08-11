import { Idea } from "@carbon/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { startupTips } from "../startup-tips.js";

const ROTATE_MS = 6_000;
const FADE_OUT_MS = 300;
const FADE_IN_MS = 600;
const ENTER_DELAY_MS = 1_000;

function pickNext(current: number, count: number): number {
  if (count < 2) return current;
  return (current + 1 + Math.floor(Math.random() * (count - 1))) % count;
}

function render(tip: string) {
  return tip.split(/`([^`]+)`/g).map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="font-mono text-[13px]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

export function StartupTip({ sandbox }: { sandbox: string }) {
  const tips = useMemo(() => startupTips(sandbox), [sandbox]);
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * tips.length),
  );
  /** The card arriving, once. The tip inside it is opaque from the start so
   *  the whole box — border, icon, text — fades in as one thing. */
  const [revealed, setRevealed] = useState(false);
  /** The tip crossfading on a rotation, from then on. */
  const [shown, setShown] = useState(true);
  const indexRef = useRef(index);
  const swapRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const enter = setTimeout(() => setRevealed(true), ENTER_DELAY_MS);
    let rotate: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      if (tips.length < 2) return;
      rotate = setInterval(() => {
        setShown(false);
        swapRef.current = setTimeout(() => {
          indexRef.current = pickNext(indexRef.current, tips.length);
          setIndex(indexRef.current);
          setShown(true);
        }, FADE_OUT_MS);
      }, ROTATE_MS);
    }, ENTER_DELAY_MS + FADE_IN_MS);

    return () => {
      clearTimeout(enter);
      clearTimeout(start);
      clearTimeout(swapRef.current);
      clearInterval(rotate);
    };
  }, [tips.length]);

  return (
    <Callout
      className={cn(
        "w-full max-w-120 min-h-22 p-5 text-left motion-safe:transition-opacity duration-600",
        revealed ? "opacity-100" : "opacity-0 motion-reduce:opacity-100",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Idea size={16} className="text-foreground" />
        </span>
        {/* Every tip is laid out in the same grid cell, so the box is as tall
            as the longest one wraps at the current width and no rotation
            resizes it. The column above is vertically centred: a card that
            grew by a line would shift the spinner and the sandbox name, and at
            mobile widths the tips wrap to two, three, and four lines. */}
        <div className="grid flex-1">
          {tips.map((tip, i) => (
            <p
              key={tip}
              aria-hidden={i !== index}
              className={cn(
                "col-start-1 row-start-1 text-sm leading-relaxed text-muted-foreground motion-safe:transition-opacity",
                i === index && shown
                  ? "opacity-100 duration-600"
                  : "pointer-events-none select-none opacity-0 duration-300",
                i === index && "motion-reduce:opacity-100",
              )}
            >
              {render(tip)}
            </p>
          ))}
        </div>
      </div>
    </Callout>
  );
}
