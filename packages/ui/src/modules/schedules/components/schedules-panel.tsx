import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import type { Schedule } from "../../../types.js";
import { useSchedules } from "../api/queries.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import { ScheduleCard } from "./schedule-card.js";
import { ScheduleResultsModal } from "./schedule-results-modal.js";

type FormState =
  | { mode: "create" }
  | { mode: "edit"; schedule: Schedule }
  | null;

export function SchedulesPanel({
  agentId,
  onResumeSession,
}: {
  agentId: string | null;
  onResumeSession?: (sessionId: string) => void;
}) {
  const schedulesQuery = useSchedules(agentId);
  const schedules = schedulesQuery.data ?? [];

  const [form, setForm] = useState<FormState>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultsFor, setResultsFor] = useState<Schedule | null>(null);

  const closeForm = () => setForm(null);

  return (
    <>
      {schedules.length === 0 ? (
        <>
          <SectionLabel spaced>Schedules</SectionLabel>
          <EmptyStateCard
            message="You have not set up any Schedules yet"
            actionLabel="Create Schedule"
            onAction={() => setForm({ mode: "create" })}
          />
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Schedules</SectionLabel>
            <Button
              variant="outline"
              className="h-[32px] px-3 text-sm font-normal"
              onClick={() => setForm({ mode: "create" })}
            >
              <Add size={16} />
              Create Schedule
            </Button>
          </div>
          <Inset className="flex flex-col gap-3">
            {schedules.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                isExpanded={expandedId === schedule.id}
                onToggleExpanded={() =>
                  setExpandedId((prev) =>
                    prev === schedule.id ? null : schedule.id,
                  )
                }
                onEdit={() => setForm({ mode: "edit", schedule })}
                onViewResults={() => setResultsFor(schedule)}
              />
            ))}
          </Inset>
        </>
      )}

      {agentId && form && (
        <ScheduleFormModal
          agentId={agentId}
          existing={form.mode === "edit" ? form.schedule : undefined}
          onClose={closeForm}
          onSaved={closeForm}
        />
      )}

      {agentId && resultsFor && (
        <ScheduleResultsModal
          agentId={agentId}
          schedule={resultsFor}
          onClose={() => setResultsFor(null)}
          onResumeSession={onResumeSession}
        />
      )}
    </>
  );
}
