/**
 * Generic helpers for the agents module. (Agents/forks are custom resources
 * and templates are file-mounted now, and readiness comes from the
 * controller's Ready condition — so the former ConfigMap and pod
 * helpers are gone.)
 */
import crypto from "node:crypto";

export function generateK8sName(prefix: string): string {
  // 8 bytes / 16 hex chars — 64-bit keyspace makes collisions effectively
  // impossible (birthday probability at 1M IDs ever issued is ~2.7e-8),
  // so onConflictDoUpdate paths can safely refresh ownership without
  // worrying about stomping a live unrelated row.
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}
