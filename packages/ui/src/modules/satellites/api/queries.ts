import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const PRESENCE_POLL_MS = 15_000;

export function useSatellites(enabled: boolean) {
  return useQuery({
    ...trpc.satellites.list.queryOptions(),
    enabled,
    refetchInterval: (query) =>
      (query.state.data?.length ?? 0) > 0 ? PRESENCE_POLL_MS : false,
    meta: { errorToast: "Couldn't load satellites" },
  });
}
