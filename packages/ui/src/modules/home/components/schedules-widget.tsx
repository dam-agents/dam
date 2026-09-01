import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { Schedule } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import { useToggleSchedule } from "../../schedules/api/mutations.js";
import { useOwnerSchedules } from "../../schedules/api/queries.js";
import { ScheduleFormModal } from "../../schedules/forms/schedule-form-modal.js";
import { useScheduleEditGuard } from "../../schedules/hooks/use-schedule-edit-guard.js";
import { scheduleCadenceText } from "../../schedules/lib/schedule-format.js";
import { WidgetSkeleton } from "./home-skeletons.js";

const TOP_SCHEDULES = 5;

interface RowProps {
  schedule: Schedule;
  agentName: string;
  onEdit: () => void;
  dense: boolean;
}

function ScheduleRow({ schedule, agentName, onEdit, dense }: RowProps) {
  const toggle = useToggleSchedule();
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg transition-colors hover:bg-muted/50",
        dense ? "px-2 py-2" : "px-4 py-3",
        !schedule.enabled && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm text-foreground">{schedule.name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {agentName} · {scheduleCadenceText(schedule)}
        </p>
      </button>
      <Switch
        checked={schedule.enabled}
        disabled={toggle.isPending}
        onCheckedChange={() => toggle.mutate({ id: schedule.id })}
        className="shrink-0"
        aria-label={`${schedule.enabled ? "Disable" : "Enable"} ${schedule.name}`}
      />
    </div>
  );
}

export function SchedulesWidget() {
  const { data, isError, isPending } = useOwnerSchedules();
  const agents = useAgentsList();
  const { isPending: agentsPending } = useAgents();
  const guardEdit = useScheduleEditGuard();
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [creating, setCreating] = useState(false);

  if (isError) return null;
  if (isPending || agentsPending) return <WidgetSkeleton rows={3} />;

  const live = new Set(agents.map((a) => a.id));
  const schedules = (data ?? []).filter((s) => live.has(s.agentId));
  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  const rows = (list: readonly Schedule[], dense: boolean) =>
    list.map((schedule) => (
      <ScheduleRow
        key={schedule.id}
        schedule={schedule}
        agentName={nameOf(schedule.agentId)}
        dense={dense}
        onEdit={() => {
          void guardEdit(schedule, nameOf(schedule.agentId), () => {
            setListOpen(false);
            setEditing(schedule);
          });
        }}
      />
    ));

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Schedules
            {schedules.length > 0 && (
              <span className="ml-1.5">({schedules.length})</span>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={agents.length === 0}
            onClick={() => setCreating(true)}
          >
            <Add size={16} /> New
          </Button>
        </div>

        {schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing scheduled. A schedule wakes an agent and gives it a task on
            a cadence you set.
          </p>
        ) : (
          <>
            <div className="space-y-0.5">
              {rows(schedules.slice(0, TOP_SCHEDULES), true)}
            </div>
            {schedules.length > TOP_SCHEDULES && (
              <button
                type="button"
                onClick={() => setListOpen(true)}
                className="mt-3 px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                See all
              </button>
            )}
          </>
        )}
      </div>

      {listOpen && (
        <Modal widthClass="w-[520px]">
          <DialogHeader
            title={`All schedules (${schedules.length})`}
            onClose={() => setListOpen(false)}
          />
          <DialogBody className="max-h-[60vh] overflow-y-auto px-2 py-2">
            {rows(schedules, false)}
          </DialogBody>
        </Modal>
      )}

      {editing && (
        <ScheduleFormModal
          agentId={editing.agentId}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {creating && (
        <ScheduleFormModal
          agentChoices={agents.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}
    </>
  );
}
