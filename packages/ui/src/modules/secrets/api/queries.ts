import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSecrets(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.secrets.list.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load secrets" },
  });
}
