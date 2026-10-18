import { useSyncExternalStore } from "react";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 48rem)");
}

export function useIsWideDesktop(): boolean {
  return useMediaQuery("(min-width: 64rem)");
}
