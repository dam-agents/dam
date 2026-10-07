import {
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
} from "../../agents/api/harness-config.js";

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
  if (!data?.sessionModel) return [];
  if (values?.availableModels?.length) return values.availableModels;
  const models = data.catalog?.options.find((o) => o.category === "model");
  return models?.choices ?? [];
}

export function useHasHarnessDefault(agentId: string | null): boolean {
  const { values } = useResolvedHarnessConfig(agentId);
  return !!values?.defaultModel;
}
