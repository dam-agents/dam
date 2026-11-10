import { useEffect, useState } from "react";

import { prefersReducedMotion } from "@/lib/reduced-motion";

import { EXAMPLE_FADE_MS, EXAMPLE_SHOWN_MS } from "../lib/example-prompts.js";

export interface RotatingExample {
  text: string;
  fading: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the example prompt an empty composer shows, and
 * whether it is fading out. While active, the example changes every few
 * seconds: it fades out, the next one takes its place and fades in. A person
 * who asked their system for reduced motion gets the next example at once,
 * with no fade. Inactive, it shows nothing and the timers stop.
 */
export function useRotatingExample(
  examples: readonly string[],
  active: boolean,
): RotatingExample | null {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!active || examples.length < 2) return;
    const next = () => setIndex((i) => (i + 1) % examples.length);
    let swap: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      if (prefersReducedMotion()) {
        next();
        return;
      }
      setFading(true);
      swap = setTimeout(() => {
        next();
        setFading(false);
      }, EXAMPLE_FADE_MS);
    }, EXAMPLE_SHOWN_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(swap);
      setFading(false);
    };
  }, [active, examples]);

  const text = examples[index % Math.max(examples.length, 1)];
  if (!active || text === undefined) return null;
  return { text, fading };
}
