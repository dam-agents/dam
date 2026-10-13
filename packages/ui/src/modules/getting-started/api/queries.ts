import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useGettingStarted() {
  return useQuery({
    ...trpc.gettingStarted.progress.queryOptions(),
    staleTime: 60_000,
    meta: { errorToast: "Couldn't load your Get started checklist" },
  });
}
