import { Chemistry } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";

export function VmRuntimeBadge({ agent }: { agent: AgentView }) {
  if (!agent.vm) return null;
  return (
    <Badge
      variant="template"
      className="shrink-0 gap-1"
      title="Runs on the new sandbox runtime"
    >
      <Chemistry size={12} /> New runtime
    </Badge>
  );
}
