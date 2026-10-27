import { ContainerRuntime, Migrate, WarningAlt } from "@carbon/icons-react";
import { match } from "ts-pattern";

import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { runtimeBadge } from "../utils/runtime-migration.js";

export function VmRuntimeBadge({
  agent,
  labelClassName,
}: {
  agent: AgentView;
  labelClassName?: string;
}) {
  const badge = runtimeBadge(agent);
  if (!badge) return null;
  const { Icon, variant } = match(badge.kind)
    .with("migrating", () => ({ Icon: Migrate, variant: "accent" as const }))
    .with("failed", () => ({ Icon: WarningAlt, variant: "danger" as const }))
    .exhaustive(() => ({ Icon: ContainerRuntime, variant: "muted" as const }));
  return (
    <Badge variant={variant} className="shrink-0 gap-1" title={badge.title}>
      <Icon size={12} aria-hidden />
      <span className={labelClassName}>{badge.label}</span>
    </Badge>
  );
}
