import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { AddRow, ListSection } from "@/components/ui/list-section";
import { SectionLabel } from "@/components/ui/section-label";

import type { Schedule } from "../../../types.js";
import type { SectionHeaderSlot } from "../../sandboxes/components/sandbox-home-header.js";
import { useSchedules } from "../api/queries.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import { isPastOnce } from "../lib/once-schedule.js";
import { ScheduleCard } from "./schedule-card.js";
import { ScheduleResultsModal } from "./schedule-results-modal.js";

type FormState =
  { mode: "create" } | { mode: "edit"; schedule: Schedule } | null;

export function SchedulesPanel({
  agentId,
  header,
  onResumeSession,
}: {
  agentId: string;
  header: SectionHeaderSlot;
  onResumeSession: (sessionId: string) => void;
}) {
  const schedulesQuery = useSchedules(agentId);
  const schedules = schedulesQuery.data ?? [];
  const upcoming = schedules.filter((s) => !isPastOnce(s));
  const past = schedules
    .filter(isPastOnce)
    .sort((a, b) =>
      (b.status?.lastRun ?? "").localeCompare(a.status?.lastRun ?? ""),
    );
  const [pastOpen, setPastOpen] = useState(false);

  const [form, setForm] = useState<FormState>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultsFor, setResultsFor] = useState<Schedule | null>(null);

  const closeForm = () => setForm(null);

  const card = (schedule: Schedule) => (
    <ScheduleCard
      key={schedule.id}
      schedule={schedule}
      isExpanded={expandedId === schedule.id}
      onToggleExpanded={() =>
        setExpandedId((prev) => (prev === schedule.id ? null : schedule.id))
      }
      onEdit={() => setForm({ mode: "edit", schedule })}
      onViewResults={() => setResultsFor(schedule)}
    />
  );

  return (
    <>
      {header()}
      <ListSection
        loading={schedulesQuery.isPending}
        error={schedulesQuery.isError && "Couldn't load schedules."}
        isEmpty={upcoming.length === 0}
        empty="No schedules yet. Create one to run a task on a timetable or once."
        onNew={() => setForm({ mode: "create" })}
        newLabel="Create schedule"
        newTestId="schedule-new"
        addRow={
          <AddRow
            onClick={() => setForm({ mode: "create" })}
            testId="schedule-new"
          >
            <Add size={16} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-md font-medium text-foreground">
                Create schedule
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Run a task on a timetable, or once.
              </p>
            </div>
          </AddRow>
        }
        separated
      >
        {upcoming.map(card)}
      </ListSection>
      {past.length > 0 && (
        <section className="mb-8">
          <DisclosureToggle
            open={pastOpen}
            onToggle={() => setPastOpen((open) => !open)}
            className="mb-3"
          >
            <SectionLabel>{`Past one-time tasks (${past.length})`}</SectionLabel>
          </DisclosureToggle>
          {pastOpen && (
            <div className="flex flex-col gap-3">
              {past.map((schedule) => (
                <Card key={schedule.id} className="overflow-hidden">
                  {card(schedule)}
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {form && (
        <ScheduleFormModal
          agentId={agentId}
          existing={form.mode === "edit" ? form.schedule : undefined}
          onClose={closeForm}
        />
      )}

      {resultsFor && (
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
