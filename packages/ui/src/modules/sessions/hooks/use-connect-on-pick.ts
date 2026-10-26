import { useStore } from "../../../store.js";
import { useGrantProvider } from "../api/session-pair.js";
import type { ModelGroup } from "../lib/catalog-groups.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a pick from a provider the agent is not
 * connected to asks first, since connecting it lets the agent use every model
 * that provider offers. Confirmed, the provider is granted and the pick
 * applied; cancelled, or a grant that fails, changes nothing.
 */
export function useConnectOnPick(agentId: string | null) {
  const showConfirm = useStore((s) => s.showConfirm);
  const { grant } = useGrantProvider(agentId);
  return (group: ModelGroup, model: string, apply: () => void): void => {
    if (group.attached) return apply();
    void showConfirm(
      `This agent can then use every model ${group.displayName} offers, not only ${model}.`,
      `Connect ${group.displayName} to this agent?`,
      { confirmLabel: "Connect" },
    ).then(async (ok) => {
      if (ok && (await grant(group.connectionId))) apply();
    });
  };
}
