import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useLinks() {
  return useQuery({
    ...trpc.links.all.queryOptions(),
    staleTime: Infinity,
  });
}
