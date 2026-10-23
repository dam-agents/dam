import type { SessionPair } from "api-server-api";

import { useStore } from "../../../store.js";
import {
  attachProviderQuietly,
  rememberFirstModel,
  useHarnessCatalogModels,
  useProviderConnections,
} from "../api/session-pair.js";
import {
  curveBenderModelName,
  curveBenderSelected,
  sharedCurveBender,
} from "../lib/curve-bender.js";
import type { ProviderConnectionRef } from "../lib/session-pair-options.js";

const PI_HARNESS = "pi";

export function useCurveBender(input: {
  agentId: string | null;
  routed: boolean | undefined;
  session: { harness: string | null; model: string | null } | null;
  selection: { model: string | null; provider: string | null } | undefined;
  onChooseSessionModel: (model: string) => Promise<void>;
}): {
  shared: ProviderConnectionRef | undefined;
  selected: boolean | null;
  tryIt: () => void;
} {
  const providers = useProviderConnections(input.agentId);
  const shared = sharedCurveBender(providers.owned);
  const catalog = useHarnessCatalogModels(
    input.routed && shared ? input.agentId : null,
    input.session?.harness ?? PI_HARNESS,
  );
  const setPair = useStore((s) => s.setNextSessionPair);

  const tryIt = async () => {
    const { agentId, session } = input;
    if (!agentId || !shared) return;
    const attached = !providers.granted.some((p) => p.id === shared.id);
    if (attached && !(await attachProviderQuietly(agentId, shared.id))) return;
    const model = curveBenderModelName(catalog.data, shared.id);
    if (session) {
      await input.onChooseSessionModel(model);
      return;
    }
    const pair: SessionPair = {
      harness: PI_HARNESS,
      provider: shared.id,
      model,
    };
    setPair(agentId, pair);
    void rememberFirstModel(agentId, pair);
  };

  return {
    shared,
    selected:
      !providers.loaded || input.selection === undefined
        ? null
        : curveBenderSelected({
            model: input.selection.model,
            provider: input.selection.provider,
            connections: providers.granted,
          }),
    tryIt: () => void tryIt(),
  };
}
