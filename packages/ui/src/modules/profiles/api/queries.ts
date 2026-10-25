import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/** UNIT_BOUNDARY_DESCRIPTION: the owner's profiles; one place creates, edits and deletes them, and every picker reads them. */
export function useProfiles(agentId?: string | null) {
  return useQuery({
    ...trpc.profiles.list.queryOptions(
      agentId === undefined ? {} : agentId === null ? skipToken : { agentId },
    ),
    staleTime: 30_000,
  });
}
