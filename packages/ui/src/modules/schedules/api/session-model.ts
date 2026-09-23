import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";

export interface SessionModelChoice {
  value: string;
  name: string;
}

export function useSessionModelChoices(
  agentId: string | null,
): readonly SessionModelChoice[] {
  const { data } = useHarnessConfigStatus(agentId);
  if (!data?.sessionModel) return [];
  const models = data.catalog?.options.find((o) => o.category === "model");
  return models?.choices ?? [];
}
