import { useEffect, useState } from "react";

/**
 * The value, trailing its source by `delayMs` of quiet. For consumers that
 * must see settled input rather than every intermediate step — an `aria-live`
 * region fed per keystroke announces the typing instead of the result.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
