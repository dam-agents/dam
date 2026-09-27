import { Chemistry, ContainerRuntime } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";
import { runtimeBadge } from "../utils/runtime-migration.js";

export function VmRuntimeBadge({ agent }: { agent: AgentView }) {
  const badge = runtimeBadge(agent, useVmRuntime());
  if (!badge) return null;
  const Icon = badge.kind === "new" ? Chemistry : ContainerRuntime;
  return (
    <Badge
      variant={badge.kind === "new" ? "template" : "muted"}
      className="shrink-0 gap-1"
      title={badge.title}
    >
      <Icon size={12} aria-hidden /> {badge.label}
    </Badge>
  );
}
