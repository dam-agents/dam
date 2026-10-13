import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { CeilingOverride } from "../services/budgets-service.js";

const USERBUDGETS_PLURAL = "userbudgets";

export async function readUserBudgetCeiling(
  k8s: K8sClient,
  owner: string,
): Promise<CeilingOverride | null> {
  const obj = await k8s.getCustomObject(USERBUDGETS_PLURAL, `budget-${owner}`);
  if (!obj) return null;
  const spec = (obj as { spec?: { cpu?: unknown; memory?: unknown } }).spec;
  const cpu = quantityString(spec?.cpu);
  const memory = quantityString(spec?.memory);
  return {
    ...(cpu !== null && { cpu }),
    ...(memory !== null && { memory }),
  };
}

function quantityString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
