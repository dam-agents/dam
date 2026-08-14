import { Badge } from "@/components/ui/badge";

import { useIsImporting } from "../hooks/use-is-importing.js";

interface Props {
  agentId: string | null;
}

export function ImportInProgressBadge({ agentId }: Props) {
  const importing = useIsImporting(agentId);
  if (!importing) return null;
  return <Badge variant="accent">Importing…</Badge>;
}
