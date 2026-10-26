import { Add } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { AddRow, ListSection } from "@/components/ui/list-section";
import { SectionLabel } from "@/components/ui/section-label";

import type { Schedule } from "../../../types.js";
import type { SectionHeaderSlot } from "../../sandboxes/components/sandbox-home-header.js";
import { useSchedules } from "../api/queries.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import type { CreatedSchedule } from "../lib/just-ask.js";
import { isPastOnce } from "../lib/once-schedule.js";
import { ScheduleCard } from "./schedule-card.js";
import { ScheduleResultsModal } from "./schedule-results-modal.js";

type FormState =
  { mode: "create" } | { mode: "edit"; schedule: Schedule } | null;

export function SchedulesPanel({
  agentId,
  header,
  panel = false,
  onResumeSession,
  focusId,
  onFocusApplied,
  onCreated,
}: {
  agentId: string;
  header: SectionHeaderSlot;
  panel?: boolean;
  onResumeSession: (sessionId: string) => void;
  focusId?: string | null;
  onFocusApplied?: () => void;
  onCreated?: (draft: CreatedSchedule) => void;
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
  // UNIT_BOUNDARY_DESCRIPTION: a focused item comes from a card in the chat, so it is applied once — expanded, its Past group opened if it sits there, and scrolled to — and then released, so the next click on the same card and every later opening of the tab behave the same.
  useEffect(() => {
    if (!focusId || schedulesQuery.data === undefined) return;
    setExpandedId(focusId);
    if (past.some((s) => s.id === focusId)) setPastOpen(true);
  }, [focusId, schedulesQuery.data, past]);

  // UNIT_BOUNDARY_DESCRIPTION: the release waits for the row itself, since expanding it and opening its Past group are renders of their own; a card that is not on screen yet keeps the focus, so the scroll happens once the list has drawn it.
  useEffect(() => {
    if (!focusId) return;
    const row = document.querySelector(
      `[data-schedule-id="${CSS.escape(focusId)}"]`,
    );
    if (row === null) return;
    row.scrollIntoView({ block: "nearest" });
    onFocusApplied?.();
  }, [focusId, expandedId, pastOpen, onFocusApplied]);

  const closeForm = () => setForm(null);

  const card = (schedule: Schedule) => (
    <div key={schedule.id} data-schedule-id={schedule.id}>
      <ScheduleCard
        schedule={schedule}
        isExpanded={expandedId === schedule.id}
        onToggleExpanded={() =>
          setExpandedId((prev) => (prev === schedule.id ? null : schedule.id))
        }
        onEdit={() => setForm({ mode: "edit", schedule })}
        onViewResults={() => setResultsFor(schedule)}
      />
    </div>
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
        addInHeader={panel}
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
          onCreated={onCreated}
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
