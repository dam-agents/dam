import { useQuery } from "@tanstack/react-query";

import { api } from "../../../api.js";
import type { InstanceView } from "../../../types.js";

export const instancesKeys = {
  root: ["instances"] as const,
  listWithChannels: () => [...instancesKeys.root, "list-with-channels"] as const,
};

/**
 * Single combined query for the instances list + available channels. The two
 * are always consumed together (instance panels render channel pills), and
 * pairing them avoids a render pass where one is loaded but not the other.
 */
export function useInstances() {
  return useQuery({
    queryKey: instancesKeys.listWithChannels(),
    queryFn: async () => {
      const [list, availableChannels] = await Promise.all([
        api.instances.list.query(),
        api.channels.available.query(),
      ]);
      return { list, availableChannels };
    },
    refetchInterval: 5000,
    staleTime: 5000,
    meta: { errorToast: "Can't reach the server — instance list may be stale" },
  });
}

const EMPTY_INSTANCES: readonly InstanceView[] = Object.freeze([]);

/**
 * Stable view of just the instance list. Inline `data?.list ?? []` mints a
 * fresh array on every render and destabilizes any useEffect / useMemo deps
 * downstream — this hook returns the same `EMPTY_INSTANCES` reference until
 * real data arrives.
 */
export function useInstancesList(): readonly InstanceView[] {
  const { data } = useInstances();
  return data?.list ?? EMPTY_INSTANCES;
}
