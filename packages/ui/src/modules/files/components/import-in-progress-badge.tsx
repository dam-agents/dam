import { StatusBadge } from "../../../components/status-indicator.js";
import { useIsImporting } from "../hooks/use-is-importing.js";

interface Props {
  agentId: string | null;
}

/** Active indicator: a file upload/import is in flight for this agent. */
export function ImportInProgressBadge({ agentId }: Props) {
  const importing = useIsImporting(agentId);
  if (!importing) return null;
  return (
    <span title="Importing files into the agent">
      <StatusBadge
        label="Importing…"
        colorClasses="bg-accent-light text-accent border-accent"
      />
    </span>
  );
}
