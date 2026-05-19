import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { FormError } from "../../../components/form-error.js";
import type { Schedule } from "../../../types.js";
import { useCreateSchedule, useUpdateSchedule } from "../api/mutations.js";
import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  detectTimezone,
  type FrequencyPreset,
  hasVisibleOccurrence,
  rruleToText,
} from "../domain/rrule-builder.js";

const INPUT_CLASS =
  "w-full h-8 rounded-md border-2 border-border-light bg-surface px-3 text-[12px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";

// Time inputs render HH:MM plus a picker glyph; ~7.5rem is enough for both.
const TIME_INPUT_CLASS = INPUT_CLASS.replace("w-full", "w-[7.5rem]");
const NUMBER_INPUT_CLASS = INPUT_CLASS.replace("w-full", "w-20");

const DAYS_ISO: { iso: number; label: string }[] = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

type QuietRow = { startTime: string; endTime: string; enabled: boolean };

interface Props {
  agentId: string;
  /** When set, the form is in edit mode — prefills from the schedule and
   *  calls `updateRRule` on submit. When omitted, the form creates a new
   *  schedule via `createRRule`. */
  existing?: Schedule;
  onCancel: () => void;
  onSaved: () => void;
}

export function CreateScheduleForm({
  agentId,
  existing,
  onCancel,
  onSaved,
}: Props) {
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const mutation = existing ? updateSchedule : createSchedule;

  // Seed RRULE-builder state from the existing schedule when editing.
  // For edit, we try to recognise the RRULE body against the known presets;
  // unrecognised bodies open in the "custom" editor with the raw string.
  const initialPreset: FrequencyPreset = existing?.rrule
    ? detectPreset(existing.rrule)
    : { kind: "daily", hour: 9, minute: 0, days: [...ALL_DAYS] };

  const [name, setName] = useState(existing?.name ?? "");
  const [task, setTask] = useState(existing?.task ?? "");
  const [sessionMode, setSessionMode] = useState<"fresh" | "continuous">(
    existing?.sessionMode ?? "fresh",
  );
  const [timezone, setTimezone] = useState(
    existing?.timezone ?? detectTimezone(),
  );

  const [kind, setKind] = useState<FrequencyPreset["kind"]>(initialPreset.kind);
  // Interval is held as the raw input text so the user can clear/retype
  // freely without the onChange coercing an empty string back to "1" and
  // pinning the caret. Parsed to a number on read.
  const [intervalText, setIntervalText] = useState(
    initialPreset.kind === "minutely" || initialPreset.kind === "hourly"
      ? String(initialPreset.interval)
      : "30",
  );
  const interval = Math.max(1, Number.parseInt(intervalText, 10) || 1);
  const [hour, setHour] = useState(
    initialPreset.kind === "daily" ? initialPreset.hour : 9,
  );
  const [minute, setMinute] = useState(
    initialPreset.kind === "daily" ? initialPreset.minute : 0,
  );
  const [days, setDays] = useState<number[]>(
    initialPreset.kind === "custom" ? [...ALL_DAYS] : initialPreset.days,
  );
  const [customRRule, setCustomRRule] = useState(
    initialPreset.kind === "custom"
      ? initialPreset.rrule
      : (existing?.rrule ?? "FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"),
  );

  const [quietHours, setQuietHours] = useState<QuietRow[]>(
    existing?.quietHours ?? [],
  );

  const preset: FrequencyPreset = useMemo(() => {
    switch (kind) {
      case "minutely":
        return { kind, interval, days };
      case "hourly":
        return { kind, interval, days };
      case "daily":
        return { kind, hour, minute, days };
      case "custom":
        return { kind, rrule: customRRule };
    }
  }, [kind, interval, hour, minute, days, customRRule]);

  const { rruleBody, rruleSummary, rruleError } = useMemo(() => {
    try {
      const body = buildRRule(preset);
      return {
        rruleBody: body,
        rruleSummary: rruleToText(body),
        rruleError: null as string | null,
      };
    } catch (e) {
      return {
        rruleBody: "",
        rruleSummary: "",
        rruleError: (e as Error).message,
      };
    }
  }, [preset]);

  const nameError = name.trim().length === 0 ? "Required" : null;
  const taskError = task.trim().length === 0 ? "Required" : null;
  const tzError = timezone.trim().length === 0 ? "Required" : null;
  const quietHoursError = quietHours.some((q) => q.startTime === q.endTime)
    ? "start and end must differ"
    : null;
  const daysError =
    kind !== "custom" && days.length === 0 ? "Pick at least one day" : null;

  // Catch the footgun where every scheduled tick falls inside a quiet
  // window — the goroutine would spin its iteration cap and never fire.
  // Only check once the rule itself is syntactically valid, otherwise we
  // double-report the same problem.
  const unreachableError = useMemo(() => {
    if (rruleError || rruleBody.length === 0 || quietHoursError) return null;
    return hasVisibleOccurrence(rruleBody, quietHours)
      ? null
      : "Quiet hours cover every scheduled occurrence — this schedule would never fire.";
  }, [rruleBody, rruleError, quietHours, quietHoursError]);

  const isValid =
    !nameError &&
    !taskError &&
    !tzError &&
    !rruleError &&
    !quietHoursError &&
    !daysError &&
    !unreachableError &&
    rruleBody.length > 0;

  function toggleDay(iso: number) {
    setDays((prev) =>
      prev.includes(iso)
        ? prev.filter((d) => d !== iso)
        : [...prev, iso].sort(),
    );
  }

  function addQuietHour() {
    setQuietHours((prev) => [
      ...prev,
      { startTime: "22:00", endTime: "06:00", enabled: true },
    ]);
  }

  function updateQuietHour(idx: number, patch: Partial<QuietRow>) {
    setQuietHours((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    );
  }

  function removeQuietHour(idx: number) {
    setQuietHours((prev) => prev.filter((_, i) => i !== idx));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    const common = {
      name: name.trim(),
      rrule: rruleBody,
      timezone: timezone.trim(),
      quietHours,
      task: task.trim(),
      sessionMode,
    };
    if (existing) {
      updateSchedule.mutate(
        { id: existing.id, ...common },
        { onSuccess: onSaved },
      );
    } else {
      createSchedule.mutate({ agentId, ...common }, { onSuccess: onSaved });
    }
  }

  return (
    <form
      className="flex flex-col gap-3 border-b border-border-light p-4 anim-in"
      onSubmit={onSubmit}
    >
      <div>
        <input
          className={INPUT_CLASS}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <FormError message={nameError ?? undefined} />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-text-secondary">
          Run
        </label>
        <div className="flex flex-wrap gap-1">
          {(["minutely", "hourly", "daily", "custom"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 capitalize ${kind === k ? "bg-accent text-white border-accent-hover" : "bg-surface text-text-muted border-border-light"}`}
              onClick={() => setKind(k)}
            >
              {k === "minutely"
                ? "Every N min"
                : k === "hourly"
                  ? "Every N hr"
                  : k}
            </button>
          ))}
        </div>

        {(kind === "minutely" || kind === "hourly") && (
          <div className="flex items-center gap-2 text-[12px] text-text">
            <span>Every</span>
            <input
              type="number"
              min={1}
              className={NUMBER_INPUT_CLASS}
              value={intervalText}
              onChange={(e) => setIntervalText(e.target.value)}
              onBlur={() => setIntervalText(String(interval))}
            />
            <span>{kind === "minutely" ? "minutes" : "hours"}</span>
          </div>
        )}

        {kind === "daily" && (
          <div className="flex items-center gap-2 text-[12px] text-text">
            <span>at</span>
            <input
              type="time"
              className={TIME_INPUT_CLASS}
              value={`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                setHour(h ?? 0);
                setMinute(m ?? 0);
              }}
            />
          </div>
        )}

        {kind !== "custom" && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-text-muted">on</span>
            <div className="flex flex-wrap gap-1">
              {DAYS_ISO.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 ${days.includes(d.iso) ? "bg-accent text-white border-accent-hover" : "bg-surface text-text-muted border-border-light"}`}
                  onClick={() => toggleDay(d.iso)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <FormError message={daysError ?? undefined} />
          </div>
        )}

        {kind === "custom" && (
          <input
            className={`${INPUT_CLASS} font-mono`}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"
            value={customRRule}
            onChange={(e) => setCustomRRule(e.target.value)}
          />
        )}

        {rruleError ? (
          <FormError message={rruleError} />
        ) : (
          rruleSummary && (
            <p className="text-[11px] text-text-muted italic">{rruleSummary}</p>
          )
        )}
      </div>

      <div>
        <label className="text-[11px] font-semibold text-text-secondary">
          Timezone
        </label>
        <input
          className={INPUT_CLASS}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Europe/Prague"
        />
        <FormError message={tzError ?? undefined} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-text-secondary">
            Quiet hours
          </label>
          <button
            type="button"
            onClick={addQuietHour}
            className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 border-border-light rounded-full px-2.5 py-0.5 text-text-muted hover:text-accent hover:border-accent"
          >
            + Add
          </button>
        </div>
        <p className="text-[11px] text-text-muted italic -mt-1">
          Runs inside the window are suppressed; start time is inside, end time
          is outside (e.g. 22:00→06:00 skips the 22:00 tick, fires at 06:00).
        </p>
        {quietHours.length === 0 && (
          <p className="text-[11px] text-text-muted italic">
            None — schedule fires on every occurrence.
          </p>
        )}
        {quietHours.map((q, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="time"
              className={TIME_INPUT_CLASS}
              value={q.startTime}
              onChange={(e) =>
                updateQuietHour(idx, { startTime: e.target.value })
              }
            />
            <span className="text-[12px] text-text-muted">→</span>
            <input
              type="time"
              className={TIME_INPUT_CLASS}
              value={q.endTime}
              onChange={(e) =>
                updateQuietHour(idx, { endTime: e.target.value })
              }
            />
            <button
              type="button"
              onClick={() => updateQuietHour(idx, { enabled: !q.enabled })}
              className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 ${q.enabled ? "bg-success-light text-success border-success" : "bg-bg text-text-muted border-border-light"}`}
            >
              {q.enabled ? "On" : "Off"}
            </button>
            <button
              type="button"
              onClick={() => removeQuietHour(idx)}
              className="text-text-muted hover:text-danger transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <FormError message={quietHoursError ?? undefined} />
        <FormError message={unreachableError ?? undefined} />
      </div>

      <div>
        <textarea
          className="w-full rounded-md border-2 border-border-light bg-surface px-3 py-2 text-[12px] text-text outline-none transition-all focus:border-accent resize-y min-h-[50px]"
          placeholder="Task prompt"
          rows={2}
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
        <FormError message={taskError ?? undefined} />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-text-secondary">
          Session:
        </span>
        {(["fresh", "continuous"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 capitalize ${sessionMode === mode ? "bg-accent text-white border-accent-hover" : "bg-surface text-text-muted border-border-light"}`}
            onClick={() => setSessionMode(mode)}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="h-7 rounded-md border-2 border-border-light px-3 text-[11px] font-semibold text-text-muted hover:text-text transition-colors"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-brutal h-7 rounded-md border-2 border-accent-hover bg-accent px-3.5 text-[11px] font-bold text-white shadow-brutal-accent disabled:opacity-40"
          disabled={!isValid || mutation.isPending}
        >
          {mutation.isPending ? "..." : existing ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}
