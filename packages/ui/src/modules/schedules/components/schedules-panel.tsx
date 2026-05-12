import {
  Add as Plus,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useSchedules, useScheduleSessions } from "../api/queries.js";
import { CreateScheduleForm } from "../forms/create-schedule-form.js";
import { ScheduleCard } from "./schedule-card.js";

export function SchedulesPanel({ onResumeSession }: { onResumeSession?: (sessionId: string) => void }) {
  const selectedInstance = useStore(s => s.selectedInstance);

  const schedulesQuery = useSchedules(selectedInstance);
  const schedules = schedulesQuery.data ?? [];

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sessionsQuery = useScheduleSessions(expandedId);
  const sessionsForExpanded = sessionsQuery.data ?? [];

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2.5 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-[11px]"
          onClick={() => { setIsCreating(true); setEditingId(null); }}
        >
          <Plus size={12} /> Add Schedule
        </Button>
      </div>

      {isCreating && selectedInstance && (
        <CreateScheduleForm
          instanceId={selectedInstance}
          onCancel={() => setIsCreating(false)}
          onSaved={() => setIsCreating(false)}
        />
      )}

      {schedules.length === 0 && !isCreating && <p className="px-4 py-5 text-[12px] text-muted-foreground">No schedules</p>}
      {schedules.map(schedule => (
        editingId === schedule.id && selectedInstance ? (
          <CreateScheduleForm
            key={schedule.id}
            instanceId={selectedInstance}
            existing={schedule}
            onCancel={() => setEditingId(null)}
            onSaved={() => setEditingId(null)}
          />
        ) : (
          <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            isExpanded={expandedId === schedule.id}
            sessions={expandedId === schedule.id ? sessionsForExpanded : []}
            onToggleExpanded={() => setExpandedId(prev => prev === schedule.id ? null : schedule.id)}
            onEdit={() => { setEditingId(schedule.id); setIsCreating(false); }}
            onResumeSession={onResumeSession}
          />
        )
      ))}
    </div>
  );
}
