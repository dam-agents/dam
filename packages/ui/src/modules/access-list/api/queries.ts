import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useAccessList() {
  return useQuery({
    ...trpc.accessList.list.queryOptions(),
    meta: { errorToast: "Couldn't load the access list" },
  });
}
