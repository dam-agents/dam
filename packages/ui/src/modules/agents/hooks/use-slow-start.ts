import { useEffect, useMemo } from "react";

import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useAgents } from "../api/queries.js";
import { transitionStartingSince } from "../store.js";

// UNIT_BOUNDARY_DESCRIPTION: the api-server's wake gives up after two minutes, so an agent still starting past that is stuck, not slow. The clock starts when this tab first saw the agent starting, because the controller keeps no start time: a reload restarts the wait.
const SLOW_START_MS = 120_000;

export function useSlowStartIds(): ReadonlySet<string> {
  const { data } = useAgents();
  const startingSince = useStore((s) => s.startingSince);
  const setStartingSince = useStore((s) => s.setStartingSince);
  const now = useNow(10_000).getTime();

  useEffect(() => {
    if (!data) return;
    const current = useStore.getState().startingSince;
    const next = transitionStartingSince(current, data.list);
    if (next !== current) setStartingSince(next);
  }, [data, setStartingSince]);

  return useMemo(
    () =>
      new Set(
        [...startingSince]
          .filter(([, since]) => now - since >= SLOW_START_MS)
          .map(([id]) => id),
      ),
    [startingSince, now],
  );
}
