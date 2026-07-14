import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const USERBUDGETS_PLURAL = "userbudgets";

/** Read one owner's UserBudget CR ceiling, or null for "use the default".
 *  The CR name is CEL-pinned to `budget-<owner>` at admission, so a direct
 *  get is complete — no list-and-filter. */
export function createUserBudgetsReader(k8s: K8sClient) {
  return {
    async ceiling(
      owner: string,
    ): Promise<{ cpu: string; memory: string } | null> {
      const obj = await k8s.getCustomObject(
        USERBUDGETS_PLURAL,
        `budget-${owner}`,
      );
      if (!obj) return null;
      const spec = (obj as { spec?: { cpu?: unknown; memory?: unknown } }).spec;
      // Quantities are int-or-string in the CRD schema; `cpu: 4` (unquoted
      // YAML) arrives as a number.
      const cpu = quantityString(spec?.cpu);
      const memory = quantityString(spec?.memory);
      return cpu !== null && memory !== null ? { cpu, memory } : null;
    },
  };
}

function quantityString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
