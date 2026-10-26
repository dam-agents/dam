import type { SessionPair } from "api-server-api";

import { useStore } from "../../../store.js";
import {
  attachProviderQuietly,
  rememberSessionPair,
  useHarnessCatalogModels,
  useProviderConnections,
} from "../api/session-pair.js";
import {
  curveBenderModelName,
  sharedCurveBender,
} from "../lib/curve-bender.js";
import type { ProviderConnectionRef } from "../lib/session-pair-options.js";

const PI_HARNESS = "pi";

export function useCurveBender(input: {
  agentId: string | null;
  routed: boolean | undefined;
  session: { harness: string | null; model: string | null } | null;
  onChooseSessionModel: (model: string) => Promise<void>;
}): {
  shared: ProviderConnectionRef | undefined;
  tryIt: () => Promise<boolean>;
} {
  const providers = useProviderConnections(input.agentId);
  const shared = sharedCurveBender(providers.owned);
  const catalog = useHarnessCatalogModels(
    input.agentId,
    input.routed && shared ? (input.session?.harness ?? PI_HARNESS) : null,
  );
  const setPair = useStore((s) => s.setNextSessionPair);

  const tryIt = async (): Promise<boolean> => {
    const { agentId, session } = input;
    if (!agentId || !shared) return false;
    const attached = !providers.granted.some((p) => p.id === shared.id);
    if (attached && !(await attachProviderQuietly(agentId, shared.id)))
      return false;
    const model = curveBenderModelName(catalog.data, shared.id);
    if (session) {
      await input.onChooseSessionModel(model);
      return true;
    }
    const pair: SessionPair = {
      harness: PI_HARNESS,
      provider: shared.id,
      model,
    };
    setPair(agentId, pair);
    /* UNIT_BOUNDARY_DESCRIPTION: the last pick in any chat is the next chat's
     * default (D90), and this alert's pick is a pick. */
    rememberSessionPair(agentId, pair, "chat");
    return true;
  };

  return { shared, tryIt };
}
