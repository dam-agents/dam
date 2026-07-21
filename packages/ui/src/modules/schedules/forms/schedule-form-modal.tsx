import { Information } from "@carbon/icons-react";
import { detectTimezone, hasVisibleOccurrence } from "api-server-api";
import { useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import type { Schedule } from "../../../types.js";
import { useCreateSchedule, useUpdateSchedule } from "../api/mutations.js";
import { useRruleBuilder } from "../hooks/use-rrule-builder.js";
import {
  formatTime12,
  RUN_OPTIONS,
  TIME_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../lib/schedule-form-options.js";
import { QuietHoursEditor, type QuietRow } from "./quiet-hours-editor.js";

const DAYS_ISO: { iso: number; label: string }[] = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

const SESSION_TOOLTIP =
  "Fresh starts a new session each run. Continuous resumes one ongoing session, keeping context across runs.";

interface Props {
  agentId: string;
  /** When set, the form edits this schedule (prefilled, calls updateRRule);
   *  otherwise it creates a new one. */
  existing?: Schedule;
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleFormModal({
  agentId,
  existing,
  onClose,
  onSaved,
}: Props) {
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const mutation = existing ? updateSchedule : createSchedule;

  const c = useRruleBuilder(existing?.rrule);

  const [name, setName] = useState(existing?.name ?? "");
  const [task, setTask] = useState(existing?.task ?? "");
  const [sessionMode, setSessionMode] = useState<"fresh" | "continuous">(
    existing?.sessionMode ?? "fresh",
  );
  const [timezone, setTimezone] = useState(
    existing?.timezone ?? detectTimezone(),
  );
  const [quietHours, setQuietHours] = useState<QuietRow[]>(
    existing?.quietHours ?? [],
  );
  // Surface required-field errors only after a submit attempt, so a
  // freshly-opened form (auto-focused, then blurred) isn't pre-littered.
  const [submitted, setSubmitted] = useState(false);

  const nameError = name.trim().length === 0 ? "Required" : null;
  const taskError = task.trim().length === 0 ? "Required" : null;
  const tzError = timezone.trim().length === 0 ? "Required" : null;
  const quietHoursError = quietHours.some((q) => q.startTime === q.endTime)
    ? "Start and end must differ"
    : null;

  // Guard the footgun where every tick lands inside a quiet window — the
  // schedule would never fire. Only checked once the rule itself is valid.
  const unreachableError = useMemo(() => {
    if (c.rruleError || c.rruleBody.length === 0 || quietHoursError)
      return null;
    return hasVisibleOccurrence(c.rruleBody, quietHours)
      ? null
      : "Quiet hours cover every scheduled occurrence — this schedule would never fire.";
  }, [c.rruleBody, c.rruleError, quietHours, quietHoursError]);

  const isValid =
    !nameError &&
    !taskError &&
    !tzError &&
    !c.rruleError &&
    !quietHoursError &&
    !c.daysError &&
    !unreachableError &&
    c.rruleBody.length > 0;

  const currentTime = `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
  const timeOptions = TIME_OPTIONS.some((o) => o.value === currentTime)
    ? TIME_OPTIONS
    : [
        { value: currentTime, label: formatTime12(currentTime) },
        ...TIME_OPTIONS,
      ];

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!isValid) return;
    const common = {
      name: name.trim(),
      rrule: c.rruleBody,
      timezone: timezone.trim(),
      quietHours,
      task: task.trim(),
      sessionMode,
    };
    const onSuccess = () => {
      onSaved();
      onClose();
    };
    if (existing) {
      updateSchedule.mutate({ id: existing.id, ...common }, { onSuccess });
    } else {
      createSchedule.mutate({ agentId, ...common }, { onSuccess });
    }
  }

  return (
    <Modal>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        <DialogHeader>
          <h2 className="text-[16px] font-semibold text-foreground">
            {existing ? "Edit schedule" : "Create a new Schedule"}
          </h2>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <FormField
            label="Name"
            error={submitted ? (nameError ?? undefined) : undefined}
            disableInset
          >
            <Input
              className="h-[40px]"
              placeholder={`eg. "Daily brief"`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <div className="flex flex-col gap-2">
            <SectionLabel>Run</SectionLabel>
            <Select
              className="h-[40px]"
              value={c.kind}
              onChange={(e) => c.setKind(e.target.value as typeof c.kind)}
            >
              {RUN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          {c.kind === "daily" && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Time</SectionLabel>
              <Select
                className="h-[40px]"
                value={currentTime}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  c.setTime(h ?? 0, m ?? 0);
                }}
              >
                {timeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {(c.kind === "minutely" || c.kind === "hourly") && (
            <div className="flex items-center gap-2 text-[13px] text-foreground">
              <span>Every</span>
              <Input
                type="number"
                min={1}
                className="h-[40px] w-[80px]"
                value={c.intervalText}
                onChange={(e) => c.setIntervalText(e.target.value)}
                onBlur={() => c.setIntervalText(String(c.interval))}
              />
              <span>{c.kind === "minutely" ? "minutes" : "hours"}</span>
            </div>
          )}

          {c.kind !== "custom" && (
            <div className="flex flex-col gap-2">
              <SectionLabel>On</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {DAYS_ISO.map((d) => (
                  <button
                    key={d.iso}
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1 text-[12px] font-medium",
                      c.days.includes(d.iso)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                    onClick={() => c.toggleDay(d.iso)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <FormError message={c.daysError ?? undefined} />
            </div>
          )}

          {c.kind === "custom" && (
            <div className="flex flex-col gap-2">
              <SectionLabel>RRULE</SectionLabel>
              <Input
                className="h-[40px] font-mono text-[12px]"
                placeholder="FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"
                value={c.customRRule}
                onChange={(e) => c.setCustomRRule(e.target.value)}
              />
            </div>
          )}

          {c.rruleError ? (
            <FormError message={c.rruleError} />
          ) : (
            c.rruleSummary && (
              <p className="-mt-1 text-[13px] text-muted-foreground">
                {c.rruleSummary}
              </p>
            )
          )}

          <FormField label="Timezone" error={tzError ?? undefined} disableInset>
            <SearchableSelect
              value={timezone}
              onChange={setTimezone}
              options={TIMEZONE_OPTIONS}
              placeholder="Select a timezone"
            />
          </FormField>

          <QuietHoursEditor
            value={quietHours}
            onChange={setQuietHours}
            error={quietHoursError ?? undefined}
            unreachableError={unreachableError ?? undefined}
          />

          <FormField
            label="Prompt"
            error={submitted ? (taskError ?? undefined) : undefined}
            disableInset
          >
            <Textarea
              className="min-h-[80px] resize-y"
              placeholder="Enter a task prompt"
              rows={3}
              value={task}
              onChange={(e) => setTask(e.target.value)}
            />
          </FormField>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <SectionLabel>Session type</SectionLabel>
              <Tooltip content={SESSION_TOOLTIP} side="top">
                <Information size={14} className="text-muted-foreground" />
              </Tooltip>
            </div>
            <div className="flex gap-1.5">
              {(["fresh", "continuous"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1 text-[12px] font-medium capitalize",
                    sessionMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                  onClick={() => setSessionMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "…" : existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
