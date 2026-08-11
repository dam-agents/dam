import { useCallback, useState } from "react";

/**
 * A checkbox-style subset selection over a `Set`, for the "pick some of these
 * rows" pattern. Holds the immutable copy-then-mutate that every picker would
 * otherwise hand-roll, so two of them can't drift on what toggling means.
 *
 * `initial` is read once, like `useState`'s lazy initializer: a picker that
 * seeds from live data is a snapshot from mount, not a mirror of it.
 */
export function useToggleSet<T>(initial?: () => Iterable<T>): {
  selected: ReadonlySet<T>;
  has: (value: T) => boolean;
  toggle: (value: T) => void;
  setAll: (values: Iterable<T>) => void;
  clear: () => void;
} {
  const [selected, setSelected] = useState<ReadonlySet<T>>(
    () => new Set(initial?.()),
  );

  const toggle = useCallback((value: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const setAll = useCallback((values: Iterable<T>) => {
    setSelected(new Set(values));
  }, []);

  const clear = useCallback(() => setSelected(new Set<T>()), []);

  return {
    selected,
    has: (value: T) => selected.has(value),
    toggle,
    setAll,
    clear,
  };
}
