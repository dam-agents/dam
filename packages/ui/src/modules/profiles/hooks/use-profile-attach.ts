import type { ProfileWithUsage } from "api-server-api";

import { useStore } from "../../../store.js";
import {
  useGrantProvider,
  useProviderConnections,
} from "../../sessions/api/session-pair.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one repair a profile that cannot run for an
 * agent offers where the owner holds the provider and the agent does not — the
 * pick grants it (plan §c) — and the page that connects one otherwise.
 */
export function useProfileAttach(agentId: string | null) {
  const { owned } = useProviderConnections(agentId);
  const { grant } = useGrantProvider(agentId);
  const navigateToSettings = useStore((s) => s.navigateToSettings);

  return {
    manage: () => navigateToSettings("providers"),
    attach: (profile: ProfileWithUsage): Promise<boolean> => {
      const connection = owned.find(
        (p) => p.templateId === profile.providerTemplate,
      );
      if (!connection) {
        navigateToSettings("providers");
        return Promise.resolve(false);
      }
      return grant(connection.id);
    },
  };
}
