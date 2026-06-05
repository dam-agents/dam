import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useRepos() {
  return useQuery({
    ...trpc.repos.list.queryOptions(),
    meta: { errorToast: "Couldn't load repositories" },
  });
}
