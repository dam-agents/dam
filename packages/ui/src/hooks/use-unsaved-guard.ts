import { useEffect } from "react";

/**
 * Registers a browser beforeunload prompt while `dirty` is true. Route-level
 * (intra-app) guards are handled by each caller via showConfirm on navigation,
 * since we don't use react-router's history blocking.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
