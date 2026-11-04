import { useEffect } from "react";

const PINCH_ZOOMED_SCALE = 1.01;

export function useAppViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const coarsePointer = window.matchMedia("(pointer: coarse)");

    const clear = () => {
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-offset-top");
    };
    const write = (name: string, value: string) => {
      if (root.style.getPropertyValue(name) !== value)
        root.style.setProperty(name, value);
    };
    const update = () => {
      if (!coarsePointer.matches) {
        clear();
        return;
      }
      if (viewport.scale > PINCH_ZOOMED_SCALE) return;
      write("--app-height", `${viewport.height}px`);
      write("--app-offset-top", `${viewport.offsetTop}px`);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    coarsePointer.addEventListener("change", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      coarsePointer.removeEventListener("change", update);
      clear();
    };
  }, []);
}
