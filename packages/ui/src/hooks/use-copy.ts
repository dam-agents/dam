import { useCallback, useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const RESET_MS = 2000;

export function useCopy(): {
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
      timer.current = setTimeout(() => setState("idle"), RESET_MS);
    },
    [],
  );

  return { copy, state, copied: state === "copied" };
}
