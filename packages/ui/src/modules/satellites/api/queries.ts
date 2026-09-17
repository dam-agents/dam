import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const PRESENCE_POLL_MS = 15_000;

export function useSatellites() {
  return useQuery({
    ...trpc.satellites.list.queryOptions(),
    refetchInterval: PRESENCE_POLL_MS,
    meta: { errorToast: "Couldn't load satellites" },
  });
}
