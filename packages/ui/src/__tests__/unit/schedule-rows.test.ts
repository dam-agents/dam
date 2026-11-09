// TEST_OVERVIEW: a recurring schedule's settings as rows (#3976): every setting is a label on the left and its value on the right, and every choice is a dropdown — the days a summary such as "Weekdays", the session type a select, quiet hours and a precheck an inline Add on their own row — in the starter kit's card and the schedule dialog alike.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { QuietHoursEditor } from "../../modules/schedules/forms/quiet-hours-editor.js";
import {
  SchedulePrecheckField,
  ScheduleRecurrenceFields,
  ScheduleSessionTypeField,
} from "../../modules/schedules/forms/schedule-fields.js";
import {
  scheduleFormDefaults,
  type ScheduleFormValues,
} from "../../modules/schedules/forms/schedule-form-schema.js";
import { daysSummary } from "../../modules/schedules/lib/schedule-form-options.js";

vi.mock("@/components/ui/tooltip", () => ({
  HintTooltip: ({ children }: { children: ReactNode }) => children,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../store.js", () => ({ useStore: () => undefined }));
vi.mock("../../modules/agents/api/harness-config.js", () => ({}));
vi.mock("../../modules/agents/api/queries.js", () => ({}));
vi.mock("../../modules/schedules/api/session-model.js", () => ({}));
vi.mock("../../modules/sessions/components/awake-models-gate.js", () => ({}));
vi.mock(
  "../../modules/sessions/components/model-settings-panel.js",
  () => ({}),
);
vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({}));
vi.mock("../../modules/sessions/components/stored-pair-summary.js", () => ({}));

function Rows({
  days,
  precheck = "",
  quietHours = [],
}: {
  days: number[];
  precheck?: string;
  quietHours?: ScheduleFormValues["quietHours"];
}) {
  const { control, register, getValues } = useForm<ScheduleFormValues>({
    defaultValues: { ...scheduleFormDefaults(), days, precheck, quietHours },
  });
  const values = getValues();
  return createElement(
    "div",
    null,
    createElement(ScheduleRecurrenceFields, {
      control,
      register,
      errors: {},
      values,
    }),
    createElement(ScheduleSessionTypeField<ScheduleFormValues>, { control }),
    createElement(QuietHoursEditor, { control, register }),
    createElement(SchedulePrecheckField, {
      layout: "rows",
      registration: register("precheck"),
      defaultOpen: precheck !== "",
    }),
  );
}

const render = (props: Parameters<typeof Rows>[0]) =>
  renderToStaticMarkup(createElement(Rows, props));

describe("a schedule's days in one word", () => {
  // TEST_SCENARIO: the Days dropdown names a set the picked days make, and lists the short names in week order otherwise.
  it("names weekdays, weekends and every day, else lists the days", () => {
    expect(daysSummary([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(daysSummary([7, 6])).toBe("Weekends");
    expect(daysSummary([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(daysSummary([5, 1, 3])).toBe("Mon, Wed, Fri");
    expect(daysSummary([1, 2, 3, 4, 6])).toBe("Mon, Tue, Wed, Thu, Sat");
    expect(daysSummary([])).toBe("No days");
  });
});

describe("a schedule's settings as rows", () => {
  // TEST_SCENARIO: the days are one dropdown showing their summary, not seven pills, and the session type is a select, not a pair of toggle buttons.
  it("offers the days and the session type as dropdowns", () => {
    const html = render({ days: [1, 2, 3, 4, 5] });
    expect(html).toMatch(/aria-label="Days"[^>]*>Weekdays</);
    expect(html).not.toContain(">Mon<");
    expect(html).toMatch(
      /<select[^>]*aria-label="Session type"[^>]*>.*<option value="fresh"[^>]*>Fresh<\/option><option value="continuous">Continuous<\/option>/,
    );
    expect(html).not.toMatch(/<button[^>]*>(<span[^>]*>)?(fresh|continuous)</i);
  });

  // TEST_SCENARIO: quiet hours and the precheck are ordinary rows whose value is an inline Add while they hold nothing; the precheck's box shows only once one is set.
  it("shows quiet hours and the precheck as rows with an inline Add", () => {
    const empty = render({ days: [1, 2, 3, 4, 5, 6, 7] });
    expect(empty).toContain('aria-label="Add quiet hours"');
    expect(empty).toContain('aria-label="Add a precheck"');
    expect(empty).toMatch(/<div hidden="" class="mt-2"><textarea/);

    const set = render({
      days: [1, 2, 3, 4, 5, 6, 7],
      precheck: "true",
      quietHours: [{ startTime: "22:00", endTime: "06:00", enabled: true }],
    });
    expect(set).not.toContain('aria-label="Add a precheck"');
    expect(set).toMatch(/<div class="mt-2"><textarea/);
    expect(set).toContain('aria-label="Quiet from"');
    expect(set).toContain('aria-label="Quiet until"');
  });
});
