const RESUBSCRIBE_DELAY_MS = 3_000;

interface Unsubscribable {
  unsubscribe: () => void;
}

export function watchWithRetry(
  subscribe: (onError: () => void) => Unsubscribable,
): () => void {
  let disposed = false;
  let subscription: Unsubscribable | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (disposed) return;
    subscription = subscribe(() => {
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
