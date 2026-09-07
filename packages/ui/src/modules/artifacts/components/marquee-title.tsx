import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

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
      setShift(Math.min(0, el.clientWidth - el.scrollWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const reducedMotion = usePrefersReducedMotion();
  const animating = animate && shift < 0 && !reducedMotion;
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
