import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useApiKeys() {
  return useQuery({
    ...trpc.apiKeys.list.queryOptions(),
    meta: { errorToast: "Couldn't load API keys" },
  });
}
