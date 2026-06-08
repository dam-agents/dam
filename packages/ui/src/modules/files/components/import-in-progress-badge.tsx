import { StatusBadge } from "../../../components/status-indicator.js";
import { useIsImporting } from "../hooks/use-is-importing.js";

interface Props {
  agentId: string | null;
  size?: "sm" | "md";
}

/** Active indicator: a file upload/import is in flight for this agent. */
export function ImportInProgressBadge({ agentId, size = "md" }: Props) {
  const importing = useIsImporting(agentId);
  if (!importing) return null;
  return (
    <span title="Importing files into the agent">
      <StatusBadge
        size={size}
        label="Importing…"
        colorClasses="bg-accent-light text-accent border-accent"
        dotColorClasses="bg-accent anim-pulse"
      />
    </span>
  );
}
