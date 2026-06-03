import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";

/** Degraded indicator: a running agent whose most recent file import failed. */
export function ImportErrorBadge({
  importError,
  size = "md",
}: {
  importError: AgentView["importError"];
  size?: "sm" | "md";
}) {
  if (!importError) return null;
  return (
    <span title={importError}>
      <StatusBadge
        size={size}
        label="import failed"
        colorClasses="bg-warning-light text-warning border-warning"
        dotColorClasses="bg-warning"
      />
    </span>
  );
}
