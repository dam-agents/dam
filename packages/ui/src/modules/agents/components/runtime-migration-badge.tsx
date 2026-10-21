import { Migrate, WarningAlt } from "@carbon/icons-react";
import { match } from "ts-pattern";

import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { runtimeMigrationBadge } from "../utils/runtime-migration.js";

// UNIT_BOUNDARY_DESCRIPTION: where an agent's move to the new runtime shows. The move is started for the agent's owner by an operator, so it is read-only here: its phase, with the controller's reason as the tooltip, and a failure distinctly, since a stuck move is never mistaken for one still running.
export function RuntimeMigrationBadge({
  agent,
  labelClassName,
  hideTitle = false,
}: {
  agent: Pick<AgentView, "runtimeMigration">;
  labelClassName?: string;
  hideTitle?: boolean;
}) {
  const badge = runtimeMigrationBadge(agent);
  if (!badge) return null;
  const { Icon, variant } = match(badge.kind)
    .with("migrating", () => ({ Icon: Migrate, variant: "info" as const }))
    .with("failed", () => ({ Icon: WarningAlt, variant: "danger" as const }))
    .exhaustive(() => ({ Icon: Migrate, variant: "info" as const }));
  return (
    <Badge
      variant={variant}
      className="shrink-0 gap-1"
      title={hideTitle ? undefined : badge.title}
    >
      <Icon size={12} aria-hidden />
      <span className={labelClassName}>{badge.label}</span>
    </Badge>
  );
}
