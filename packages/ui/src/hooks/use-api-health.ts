import { useEffect, useRef, useSyncExternalStore } from "react";

import { getApiHealthSnapshot, subscribeApiHealth } from "../lib/api-health.js";
import { queryClient } from "../query-client.js";

export function useApiHealth() {
  const status = useSyncExternalStore(subscribeApiHealth, getApiHealthSnapshot);
  const prevRef = useRef(status);

  useEffect(() => {
    if (prevRef.current === "reconnecting" && status === "connected") {
      queryClient.invalidateQueries();
    }
    prevRef.current = status;
  }, [status]);

  return status;
}
