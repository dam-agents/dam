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
  const [shown, setShown] = useState(false);
  const indexRef = useRef(index);
  const swapRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const enter = setTimeout(() => setShown(true), ENTER_DELAY_MS);
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
    <Callout className="w-full max-w-120 min-h-22 p-5 text-left">
      <div
        className={cn(
          "flex items-start gap-3 motion-safe:transition-opacity",
          shown
            ? "opacity-100 duration-600"
            : "opacity-0 duration-300 motion-reduce:opacity-100",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Idea size={16} className="text-foreground" />
        </span>
        <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
          {render(tips[index]!)}
        </p>
      </div>
    </Callout>
  );
}
