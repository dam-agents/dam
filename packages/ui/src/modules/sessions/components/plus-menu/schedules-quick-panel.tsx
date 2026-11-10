import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useAgent } from "../../../agents/api/queries.js";
import { holds } from "../../../agents/lib/agent-permissions.js";
import { useSchedules } from "../../../schedules/api/queries.js";
import {
  DescribeButton,
  PlusMenuNote,
  PlusMenuPanelFrame,
} from "./plus-menu-panel.js";
import { QuickScheduleRow } from "./quick-schedule-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Schedules panel of the composer's + menu: the
 * Agent's schedules with how often each runs, a switch that pauses or resumes
 * a recurring one, and the ways to add one, by its form or by asking the
 * Agent.
 */
export function SchedulesQuickPanel({
  agentId,
  onBack,
  onManage,
  onCreate,
  onDescribe,
}: {
  agentId: string;
  onBack: () => void;
  onManage?: () => void;
  onCreate: () => void;
  onDescribe: () => void;
}) {
  const agent = useAgent(agentId);
  const changes = !!agent && holds(agent.access, "schedules");
  const { data: schedules, isPending, isError } = useSchedules(agentId);

  return (
    <PlusMenuPanelFrame
      title="Schedules"
      onBack={onBack}
      onManage={onManage}
      footer={
        <>
          {changes ? (
            <Button variant="outline" size="sm" onClick={onCreate}>
              <Add size={16} /> Create schedule
            </Button>
          ) : (
            <span />
          )}
          <DescribeButton onClick={onDescribe} />
        </>
      }
    >
      {isPending && <PlusMenuNote>Loading schedules…</PlusMenuNote>}
      {isError && <PlusMenuNote>Couldn't load schedules.</PlusMenuNote>}
      {schedules?.length === 0 && (
        <PlusMenuNote>
          No schedules yet. Describe what you need and the agent will set one
          up.
        </PlusMenuNote>
      )}
      {schedules && schedules.length > 0 && (
        <div className="flex flex-col gap-3 py-2">
          {schedules.map((schedule) => (
            <QuickScheduleRow
              key={schedule.id}
              schedule={schedule}
              changes={changes}
            />
          ))}
        </div>
      )}
    </PlusMenuPanelFrame>
  );
}
