import { useState } from "react";

import { Card } from "@/components/ui/card";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { ListSection } from "@/components/ui/list-section";
import { SectionLabel } from "@/components/ui/section-label";

import type { Schedule } from "../../../types.js";
import { useSchedules } from "../api/queries.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import type { ExactCronConversion } from "../lib/cron-conversion.js";
import { isPastOnce } from "../lib/once-schedule.js";
import { ConvertCronModal } from "./convert-cron-modal.js";
import { ScheduleCard } from "./schedule-card.js";
import { ScheduleResultsModal } from "./schedule-results-modal.js";

type FormState =
  | { mode: "create" }
  | { mode: "edit"; schedule: Schedule }
  | { mode: "convert"; schedule: Schedule; conversion: ExactCronConversion }
  | null;

export function SchedulesPanel({
  agentId,
  onResumeSession,
}: {
  agentId: string;
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
      onConvert={(conversion) =>
        setForm({ mode: "convert", schedule, conversion })
      }
      onViewResults={() => setResultsFor(schedule)}
    />
  );

  return (
    <>
      <ListSection
        onNew={() => setForm({ mode: "create" })}
        loading={schedulesQuery.isPending}
        error={schedulesQuery.isError && "Couldn't load schedules."}
        isEmpty={upcoming.length === 0}
        empty="No schedules yet."
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
            <Card className="divide-y divide-border overflow-hidden">
              {past.map(card)}
            </Card>
          )}
        </section>
      )}

      {form?.mode === "convert" ? (
        <ConvertCronModal
          schedule={form.schedule}
          conversion={form.conversion}
          onClose={closeForm}
          onConverted={(converted) =>
            setForm({ mode: "edit", schedule: converted })
          }
        />
      ) : (
        form && (
          <ScheduleFormModal
            agentId={agentId}
            existing={form.mode === "edit" ? form.schedule : undefined}
            onClose={closeForm}
          />
        )
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
