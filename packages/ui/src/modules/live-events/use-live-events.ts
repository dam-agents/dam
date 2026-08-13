import { useEffect } from "react";

import { api } from "../../api.js";
import {
  isTermsStaleError,
  onTermsStale,
} from "../terms/lib/on-terms-stale.js";
import { invalidateForLiveEvent } from "./invalidation.js";

export function useLiveEvents(): void {
  useEffect(() => {
    const subscription = api.events.owner.subscribe(undefined, {
      onData: invalidateForLiveEvent,
      onError: (error) => {
        if (isTermsStaleError(error)) onTermsStale();
      },
    });
    return () => subscription.unsubscribe();
  }, []);
}
