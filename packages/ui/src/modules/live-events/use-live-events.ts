import { useEffect } from "react";

import { api } from "../../api.js";
import {
  isTermsStaleError,
  onTermsStale,
} from "../terms/lib/on-terms-stale.js";
import { invalidateForLiveEvent } from "./invalidation.js";

const RESUBSCRIBE_DELAY_MS = 3_000;

export function useLiveEvents(): void {
  useEffect(() => {
    let disposed = false;
    let subscription: { unsubscribe: () => void } | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      if (disposed) return;
      subscription = api.events.owner.subscribe(undefined, {
        onData: invalidateForLiveEvent,
        onError: (error) => {
          if (isTermsStaleError(error)) {
            onTermsStale();
            return;
          }
          retry = setTimeout(open, RESUBSCRIBE_DELAY_MS);
        },
      });
    };
    open();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      subscription?.unsubscribe();
    };
  }, []);
}
