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

export const WIDE_DESKTOP_QUERY = "(min-width: 64rem)";

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 48rem)");
}

export function useIsWideDesktop(): boolean {
  return useMediaQuery(WIDE_DESKTOP_QUERY);
}
