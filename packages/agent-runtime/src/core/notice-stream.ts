export interface NoticeSource {
  close(): void;
}

export async function* noticeStream<T>(
  notice: T,
  open: (onChange: () => void) => NoticeSource,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const pending: T[] = [notice];
  let wake: (() => void) | undefined;
  const source = open(() => {
    if (pending.length === 0) pending.push(notice);
    wake?.();
  });
  const onAbort = () => wake?.();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal?.aborted) {
      const next = pending.shift();
      if (next === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
        continue;
      }
      yield next;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    source.close();
  }
}
