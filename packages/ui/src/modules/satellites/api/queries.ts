import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSatellites() {
  return useQuery({
    ...trpc.satellites.list.queryOptions(),
    refetchInterval: 15_000,
    meta: { errorToast: "Couldn't load satellites" },
  });
}
