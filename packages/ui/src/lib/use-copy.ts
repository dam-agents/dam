import { useCallback, useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/**
 * One clipboard-copy state machine for the whole UI. `copy` takes a string, or
 * an async producer for a value resolved at click time (e.g. a share URL fetched
 * on demand) — a null/empty result or a write failure lands in "failed". The
 * state resets to "idle" after `timeoutMs`. Sites render whatever feedback they
 * like off `state`/`copied`; the async and error handling live here.
 */
export function useCopy({ timeoutMs = 2000 }: { timeoutMs?: number } = {}): {
  copy: (value: string | (() => Promise<string | null>)) => Promise<void>;
  state: CopyState;
  copied: boolean;
} {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (value: string | (() => Promise<string | null>)) => {
      clearTimeout(timer.current);
      try {
        const text = typeof value === "function" ? await value() : value;
        if (!text) {
          setState("failed");
        } else {
          await navigator.clipboard.writeText(text);
          setState("copied");
        }
      } catch {
        setState("failed");
      }
      timer.current = setTimeout(() => setState("idle"), timeoutMs);
    },
    [timeoutMs],
  );

  return { copy, state, copied: state === "copied" };
}
