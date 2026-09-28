import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const USERBUDGETS_PLURAL = "userbudgets";

export async function readUserBudgetCeiling(
  k8s: K8sClient,
  owner: string,
): Promise<{ cpu: string; memory: string } | null> {
  const obj = await k8s.getCustomObject(USERBUDGETS_PLURAL, `budget-${owner}`);
  if (!obj) return null;
  const spec = (obj as { spec?: { cpu?: unknown; memory?: unknown } }).spec;
  const cpu = quantityString(spec?.cpu);
  const memory = quantityString(spec?.memory);
  return cpu !== null && memory !== null ? { cpu, memory } : null;
}

function quantityString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
