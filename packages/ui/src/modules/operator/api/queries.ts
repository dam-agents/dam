import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useOperatorAvailability() {
  return useQuery({
    ...trpc.operator.status.queryOptions(),
    staleTime: 5 * 60_000,
    meta: { errorToast: "Couldn't check whether you are a platform operator" },
  });
}
