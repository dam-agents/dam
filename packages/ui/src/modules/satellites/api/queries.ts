import { useQuery } from "@tanstack/react-query";
import type { SatelliteView } from "api-server-api";

import { trpc } from "../../../trpc.js";

export function useSatellites(options?: { fresh?: boolean }) {
  return useQuery({
    ...trpc.satellites.list.queryOptions(),
    ...(options?.fresh
      ? { staleTime: 0, refetchOnMount: "always" as const }
      : {}),
    meta: { errorToast: "Couldn't load satellites" },
  });
}

export const NO_SATELLITES: readonly SatelliteView[] = [];
