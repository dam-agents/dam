import { useSyncExternalStore } from "react";

const DESKTOP = "(min-width: 48rem)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
  );
}
