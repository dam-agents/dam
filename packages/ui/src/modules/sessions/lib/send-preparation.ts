import type { HarnessCatalogView } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";

import {
  curveBenderModelName,
  curveBenderProvider,
  sharedCurveBender,
} from "./curve-bender.js";
import type { ProviderConnectionRef } from "./session-pair-options.js";
import { type TopModel, topModelOf } from "./top-model.js";

export interface SendPreparation {
  attach: string | null;
  pair: SessionPair | null;
  model: string | null;
}

function preferredOn(
  catalog: HarnessCatalogView | undefined,
  granted: readonly ProviderConnectionRef[],
): TopModel | null {
  const preferred = topModelOf(catalog, granted);
  if (preferred) return preferred;
  const curveBender = curveBenderProvider(granted);
  return curveBender
    ? {
        provider: curveBender.id,
        model: curveBenderModelName(catalog, curveBender.id),
      }
    : null;
}

export function sendPreparation(input: {
  session: { harness: string; model: string | null } | null;
  harness: string | null;
  pair: SessionPair | null;
  granted: readonly ProviderConnectionRef[];
  owned: readonly ProviderConnectionRef[];
  catalog: HarnessCatalogView | undefined;
}): SendPreparation | null {
  if (input.session) {
    if (input.session.model !== null)
      return { attach: null, pair: null, model: null };
    const model = preferredOn(input.catalog, input.granted)?.model ?? null;
    return { attach: null, pair: null, model };
  }
  const attach =
    input.granted.length === 0
      ? (sharedCurveBender(input.owned) ?? null)
      : null;
  if (input.granted.length === 0 && attach === null) return null;
  const granted = attach ? [...input.granted, attach] : input.granted;
  if (input.pair?.model)
    return { attach: attach?.id ?? null, pair: null, model: null };
  const harness = input.pair?.harness ?? input.harness;
  if (!harness) return { attach: attach?.id ?? null, pair: null, model: null };
  const top = preferredOn(input.catalog, granted);
  return {
    attach: attach?.id ?? null,
    pair: top
      ? {
          harness,
          provider: top.provider,
          model: top.model,
          ...(input.pair?.settings && { settings: input.pair.settings }),
        }
      : null,
    model: null,
  };
}
