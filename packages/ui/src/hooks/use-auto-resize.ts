import { type RefObject, useCallback, useEffect } from "react";

/**
 * Auto-resizes a textarea to fit its content, up to 50vh.
 * Hides scrollbar when content fits; shows only when capped.
 */
export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  input: string,
) {
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.overflow = "hidden";
    const maxH = window.innerHeight * 0.5;
    if (el.scrollHeight > maxH) {
      el.style.height = `${maxH}px`;
      el.style.overflow = "auto";
    } else {
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [ref]);

  useEffect(() => {
    resize();
  }, [input, resize]);
}
