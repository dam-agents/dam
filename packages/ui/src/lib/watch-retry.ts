import {
  isTermsStaleError,
  onTermsStale,
} from "../modules/terms/lib/on-terms-stale.js";

const RESUBSCRIBE_DELAY_MS = 3_000;

interface Unsubscribable {
  unsubscribe: () => void;
}

export function watchWithRetry(
  subscribe: (onError: (error: unknown) => void) => Unsubscribable,
): () => void {
  if (import.meta.env.VITE_MOCK) return () => {};
  let disposed = false;
  let subscription: Unsubscribable | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (disposed) return;
    subscription = subscribe((error) => {
      if (isTermsStaleError(error)) {
        onTermsStale();
        return;
      }
      retry = setTimeout(open, RESUBSCRIBE_DELAY_MS);
    });
  };
  open();

  return () => {
    disposed = true;
    if (retry) clearTimeout(retry);
    subscription?.unsubscribe();
  };
}
