import { useEffect } from "react";

import { api } from "../../api.js";
import { watchWithRetry } from "../../lib/watch-retry.js";
import { invalidateForLiveEvent } from "./invalidation.js";

export function useLiveEvents(): void {
  useEffect(() => {
    return watchWithRetry((onError) =>
      api.events.owner.subscribe(undefined, {
        onData: invalidateForLiveEvent,
        onError,
      }),
    );
  }, []);
}
