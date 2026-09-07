import { useSyncExternalStore } from "react";

let mediaQuery: MediaQueryList | undefined;

function query(): MediaQueryList {
  return (mediaQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)"));
}

function subscribe(onChange: () => void): () => void {
  query().addEventListener("change", onChange);
  return () => query().removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return query().matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
