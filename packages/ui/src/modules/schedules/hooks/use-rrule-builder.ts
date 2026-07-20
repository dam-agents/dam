import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  type FrequencyPreset,
  rruleToText,
} from "api-server-api";
import { useMemo, useState } from "react";

import type { RunKind } from "../lib/schedule-form-options.js";

/**
 * Owns the RRULE-builder state behind the create/edit form's cadence controls:
 * the RUN kind, interval, time, weekdays, and custom-RRULE escape hatch. Seeds
 * from an existing schedule's RRULE via `detectPreset` when editing.
 */
export function useRruleBuilder(initialRRule?: string | null) {
  const initial: FrequencyPreset = initialRRule
    ? detectPreset(initialRRule)
    : { kind: "daily", hour: 9, minute: 0, days: [...ALL_DAYS] };

  const [kind, setKind] = useState<RunKind>(initial.kind);
  // Interval is held as raw text so the field can be cleared and retyped
  // without onChange coercing "" back to "1" and pinning the caret.
  const [intervalText, setIntervalText] = useState(
    initial.kind === "minutely" || initial.kind === "hourly"
      ? String(initial.interval)
      : "30",
  );
  const interval = Math.max(1, Number.parseInt(intervalText, 10) || 1);
  const [hour, setHour] = useState(initial.kind === "daily" ? initial.hour : 9);
  const [minute, setMinute] = useState(
    initial.kind === "daily" ? initial.minute : 0,
  );
  const [days, setDays] = useState<number[]>(
    initial.kind === "custom" ? [...ALL_DAYS] : initial.days,
  );
  const [customRRule, setCustomRRule] = useState(
    initial.kind === "custom"
      ? initial.rrule
      : (initialRRule ?? "FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"),
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

  const daysError =
    kind !== "custom" && days.length === 0 ? "Pick at least one day" : null;

  function setTime(nextHour: number, nextMinute: number) {
    setHour(nextHour);
    setMinute(nextMinute);
  }

  function toggleDay(iso: number) {
    setDays((prev) =>
      prev.includes(iso)
        ? prev.filter((d) => d !== iso)
        : [...prev, iso].sort(),
    );
  }

  return {
    kind,
    setKind,
    intervalText,
    setIntervalText,
    interval,
    hour,
    minute,
    setTime,
    days,
    toggleDay,
    customRRule,
    setCustomRRule,
    rruleBody,
    rruleSummary,
    rruleError,
    daysError,
  };
}
