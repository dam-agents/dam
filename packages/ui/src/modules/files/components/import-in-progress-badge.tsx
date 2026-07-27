import { Badge } from "@/components/ui/badge";

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
      <Badge variant="accent">Importing…</Badge>
    </span>
  );
}
