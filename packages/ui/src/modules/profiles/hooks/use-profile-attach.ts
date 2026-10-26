import type { ProfileWithUsage } from "api-server-api";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import {
  useGrantProvider,
  useProviderConnections,
} from "../../sessions/api/session-pair.js";

/** UNIT_BOUNDARY_DESCRIPTION: the repair a profile the agent cannot run offers: grant the owner's Connection of its provider (plan §c), or open the page that connects one. `attach` answers the Connection it granted, so the pick that follows names it rather than read a grant list from before the grant. */
export function useProfileAttach(agentId: string | null) {
  const { owned } = useProviderConnections(agentId);
  const { grant } = useGrantProvider(agentId);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const manage = () => navigateToSettings("providers");

  return {
    manage,
    attach: async (profile: ProfileWithUsage): Promise<string | null> => {
      const connection = owned.find(
        (p) => p.templateId === profile.providerTemplate,
      );
      if (!connection) {
        manage();
        return null;
      }
      if (!(await grant(connection.id))) return null;
      await queryClient.invalidateQueries({
        queryKey: trpc.profiles.list.queryKey(),
      });
      return connection.id;
    },
  };
}
