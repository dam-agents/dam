import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

type CopyValue = string | (() => Promise<string | null>);

const RESET_MS = 2000;

export function useCopy(): {
  copy: (value: CopyValue) => Promise<CopyState>;
  state: CopyState;
  copied: boolean;
} {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (value: CopyValue) => {
    clearTimeout(timer.current);
    const outcome = await writeToClipboard(value);
    setState(outcome);
    timer.current = setTimeout(() => setState("idle"), RESET_MS);
    return outcome;
  }, []);

  return { copy, state, copied: state === "copied" };
}

async function writeToClipboard(value: CopyValue): Promise<CopyState> {
  try {
    const text = typeof value === "function" ? await value() : value;
    if (!text) return "failed";
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
