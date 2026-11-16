import { useSyncExternalStore } from "react";

function onVisibilityChange(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(
    onVisibilityChange,
    () => document.visibilityState === "visible",
    () => true,
  );
}
