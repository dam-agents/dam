import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MAX_SHIFT_PX = 96;

export function MarqueeTitle({
  text,
  animate = true,
  className,
}: {
  text: string;
  animate?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setShift(
        Math.max(Math.min(0, el.clientWidth - el.scrollWidth), -MAX_SHIFT_PX),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const animating = animate && shift < 0;
  return (
    <span
      ref={containerRef}
      className={cn(
        "overflow-hidden whitespace-nowrap",
        !animating && "text-ellipsis",
        className,
      )}
    >
      <span
        className={cn(animating && "inline-block anim-title-marquee")}
        style={
          shift < 0
            ? ({ "--marquee-shift": `${shift}px` } as CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
