import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";

/** Degraded indicator: a running agent whose last settle left contributions unfinished. */
export function ContributionFailuresBadge({
  failures,
  size = "md",
}: {
  failures: AgentView["contributionFailures"];
  size?: "sm" | "md";
}) {
  if (failures.length === 0) return null;
  const label =
    failures.length === 1
      ? `${failures[0]!.kind} failed`
      : `${failures.length} installs failed`;
  const detail = failures.map((f) => `${f.kind}: ${f.message}`).join("\n");
  return (
    <span title={detail}>
      <StatusBadge
        size={size}
        label={label}
        colorClasses="bg-warning-light text-warning border-warning"
        dotColorClasses="bg-warning"
      />
    </span>
  );
}
