import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useSchedules, useScheduleSessions } from "../api/queries.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import { ScheduleCard } from "./schedule-card.js";

export function SchedulesPanel({
  agentId,
  onResumeSession,
}: {
  agentId: string | null;
  onResumeSession?: (sessionId: string) => void;
}) {
  const schedulesQuery = useSchedules(agentId);
  const schedules = schedulesQuery.data ?? [];

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sessionsQuery = useScheduleSessions(agentId, expandedId);
  const sessionsForExpanded = sessionsQuery.data ?? [];

  const editing = schedules.find((s) => s.id === editingId);

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2.5 shrink-0">
        <Button
          variant="outline"
          size="xs"
          className="w-full"
          onClick={() => setIsCreating(true)}
        >
          <Add size={12} /> Add Schedule
        </Button>
      </div>

      {agentId && (isCreating || editing) && (
        <ScheduleFormModal
          agentId={agentId}
          existing={editing}
          onClose={() => {
            setIsCreating(false);
            setEditingId(null);
          }}
          onSaved={() => {
            setIsCreating(false);
            setEditingId(null);
          }}
        />
      )}

      {schedules.length === 0 && (
        <p className="px-4 py-5 text-[12px] text-text-muted">No schedules</p>
      )}
      {schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          isExpanded={expandedId === schedule.id}
          sessions={expandedId === schedule.id ? sessionsForExpanded : []}
          onToggleExpanded={() =>
            setExpandedId((prev) => (prev === schedule.id ? null : schedule.id))
          }
          onEdit={() => setEditingId(schedule.id)}
          onResumeSession={onResumeSession}
        />
      ))}
    </div>
  );
}
