import { useCallback, useState } from "react";

export function useToggleSet<T>(initial?: () => Iterable<T>): {
  selected: ReadonlySet<T>;
  toggle: (value: T) => void;
  remove: (value: T) => void;
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

  const remove = useCallback((value: T) => {
    setSelected((prev) => {
      if (!prev.has(value)) return prev;
      const next = new Set(prev);
      next.delete(value);
      return next;
    });
  }, []);

  const setAll = useCallback((values: Iterable<T>) => {
    setSelected(new Set(values));
  }, []);

  const clear = useCallback(() => setSelected(new Set<T>()), []);

  return {
    selected,
    toggle,
    remove,
    setAll,
    clear,
  };
}
