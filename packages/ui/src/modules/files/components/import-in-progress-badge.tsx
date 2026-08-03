import { Badge } from "@/components/ui/badge";
import { HintTooltip } from "@/components/ui/tooltip";

import { useIsImporting } from "../hooks/use-is-importing.js";

interface Props {
  agentId: string | null;
}

/** Active indicator: a file upload/import is in flight for this agent. */
export function ImportInProgressBadge({ agentId }: Props) {
  const importing = useIsImporting(agentId);
  if (!importing) return null;
  return (
    <HintTooltip label="Importing…" content="Importing files into the agent">
      <Badge variant="accent">Importing…</Badge>
    </HintTooltip>
  );
}
