import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { CeilingOverride } from "../services/budgets-service.js";

const USERBUDGETS_PLURAL = "userbudgets";

export interface UserBudgetSizes {
  cpu: string | null;
  memory: string | null;
  storage: string | null;
}

export async function readUserBudgetSizes(
  k8s: K8sClient,
  owner: string,
): Promise<UserBudgetSizes> {
  const obj = await k8s.getCustomObject(USERBUDGETS_PLURAL, `budget-${owner}`);
  const spec = (
    obj as {
      spec?: { cpu?: unknown; memory?: unknown; storage?: unknown };
    }
  )?.spec;
  return {
    cpu: quantityString(spec?.cpu),
    memory: quantityString(spec?.memory),
    storage: quantityString(spec?.storage),
  };
}

export async function readUserBudgetCeiling(
  k8s: K8sClient,
  owner: string,
): Promise<CeilingOverride | null> {
  const { cpu, memory } = await readUserBudgetSizes(k8s, owner);
  if (cpu === null && memory === null) return null;
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
