import type { HarnessCatalogView } from "agent-runtime-api";
import { preferredModelOf } from "api-server-api";

import type { ProviderConnectionRef } from "./session-pair-options.js";

export interface TopModel {
  provider: string;
  model: string;
}

export function topModelOf(
  catalog: HarnessCatalogView | undefined,
  granted: readonly ProviderConnectionRef[],
): TopModel | null {
  const grantedIds = new Set(granted.map((p) => p.id));
  const providers = (catalog?.providers ?? []).filter(
    (p) => grantedIds.has(p.connectionId) && p.models.length > 0,
  );
  const preferred = preferredModelOf(
    "work",
    providers.map((p) => ({
      alias: p.alias,
      listed: p.models.map((m) => m.upstreamId),
    })),
  );
  if (preferred) {
    const provider = providers.find(
      (p) =>
        p.alias === preferred.alias &&
        p.models.some((m) => m.upstreamId === preferred.upstreamId),
    );
    const model = provider?.models.find(
      (m) => m.upstreamId === preferred.upstreamId,
    );
    if (provider && model)
      return { provider: provider.connectionId, model: model.name };
  }
  const first = providers[0];
  const model = first?.models[0];
  return first && model
    ? { provider: first.connectionId, model: model.name }
    : null;
}
