import {
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
} from "../../agents/api/harness-config.js";
import {
  useHarnessCatalog,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../../sessions/api/session-pair.js";
import { fittingProviders } from "../../sessions/lib/session-pair-options.js";

export interface SessionModelChoice {
  value: string;
  name: string;
  description?: string;
}

export function useSessionModelChoices(
  agentId: string | null,
): readonly SessionModelChoice[] {
  const { data } = useHarnessConfigStatus(agentId);
  const { values } = useResolvedHarnessConfig(agentId);
  const { data: remembered } = useRememberedPair(agentId);
  const { data: catalog } = useHarnessCatalog();
  const { granted } = useProviderConnections(agentId);
  const harness = data?.harnesses ? (data.defaultHarness ?? null) : null;
  const provider = !harness
    ? null
    : remembered?.harness === harness && remembered.provider
      ? remembered.provider
      : (fittingProviders(catalog?.harnesses ?? [], granted)(harness)[0] ??
        null);
  const { data: fireModels } = useProviderModels(
    harness ? agentId : null,
    harness,
    provider,
  );
  if (!data?.sessionModel) return [];
  if (harness) return fireModels?.availableModels ?? [];
  if (values?.availableModels?.length) return values.availableModels;
  const models = data.catalog?.options.find((o) => o.category === "model");
  return models?.choices ?? [];
}

export function useHasHarnessDefault(agentId: string | null): boolean {
  const { values } = useResolvedHarnessConfig(agentId);
  return !!values?.defaultModel;
}
