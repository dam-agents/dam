import { useQuery } from "@tanstack/react-query";
import type { SatelliteView } from "api-server-api";

import { trpc } from "../../../trpc.js";

const LIVE_REFETCH_MS = 5000;

export function useSatellites(options?: { live?: boolean }) {
  return useQuery({
    ...trpc.satellites.list.queryOptions(),
    ...(options?.live
      ? {
          staleTime: 0,
          refetchOnMount: "always" as const,
          refetchInterval: LIVE_REFETCH_MS,
        }
      : {}),
    meta: { errorToast: "Couldn't load satellites" },
  });
}

export const NO_SATELLITES: readonly SatelliteView[] = [];
