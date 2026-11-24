import { useAgentConnections } from "../../../agents/api/queries.js";
import { useSkillsState } from "../../../agents/api/skills.js";
import { excludeProviderConnections } from "../../../sandboxes/lib/provider-connections.js";
import { useSchedules } from "../../../schedules/api/queries.js";
import { isUpcoming } from "../../../schedules/lib/once-schedule.js";
import { countBadge, type PlusMenuPanel } from "../../lib/plus-menu.js";
import { PlusMenuRow } from "./plus-menu-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first level of the composer's + menu: attach
 * a file, then Skills, Schedules and Connections, each with how many the Agent
 * has on, opening its own panel.
 */
export function PlusMenuRoot({
  agentId,
  onAttachFile,
  onOpenPanel,
}: {
  agentId: string;
  onAttachFile: () => void;
  onOpenPanel: (panel: PlusMenuPanel) => void;
}) {
  const skillsOn = useSkillsState(agentId).data?.installed.length;
  const schedulesOn = useSchedules(agentId).data?.filter(isUpcoming).length;
  const connectionsOn = excludeProviderConnections(
    useAgentConnections(agentId).data?.connections.flatMap((c) =>
      c.connection ? [c.connection] : [],
    ) ?? [],
  ).length;

  return (
    <div className="py-1" data-testid="plus-menu-root">
      <PlusMenuRow label="Attach file" onClick={onAttachFile} />
      <PlusMenuRow
        label="Skills"
        badge={countBadge(skillsOn, "on")}
        onClick={() => onOpenPanel("skills")}
      />
      <PlusMenuRow
        label="Schedules"
        badge={countBadge(schedulesOn, "active")}
        onClick={() => onOpenPanel("schedules")}
      />
      <PlusMenuRow
        label="Connections"
        badge={countBadge(connectionsOn)}
        onClick={() => onOpenPanel("connections")}
      />
    </div>
  );
}
