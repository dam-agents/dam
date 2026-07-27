import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";

/** Degraded indicator: a running agent whose last settle left contributions unfinished. */
export function ContributionFailuresBadge({
  failures,
}: {
  failures: AgentView["contributionFailures"];
}) {
  if (failures.length === 0) return null;
  const label =
    failures.length === 1
      ? `${failures[0]!.kind} failed`
      : `${failures.length} installs failed`;
  const detail = failures.map((f) => `${f.kind}: ${f.message}`).join("\n");
  return (
    <span title={detail}>
      <Badge variant="warning">{label}</Badge>
    </span>
  );
}
