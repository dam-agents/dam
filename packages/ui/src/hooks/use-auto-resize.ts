import { type RefObject, useCallback, useEffect } from "react";

export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  input: string,
  placeholder: string,
) {
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const visibleHeight = viewport
      ? viewport.height * viewport.scale
      : window.innerHeight;
    const maxH = visibleHeight * 0.5;
    if (el.scrollHeight > maxH) {
      el.style.height = `${maxH}px`;
      el.style.overflow = "auto";
    } else {
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [ref]);

  useEffect(() => {
    resize();
  }, [input, placeholder, resize]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, [resize]);
}
