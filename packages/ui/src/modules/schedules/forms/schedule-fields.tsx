import { Add, ChevronDown, Information } from "@carbon/icons-react";
import { useId, useState } from "react";
import { flushSync } from "react-dom";
import type {
  Control,
  FieldErrors,
  FieldValues,
  Path,
  UseFormRegister,
  UseFormRegisterReturn,
} from "react-hook-form";
import { Controller, useController } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HintTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import { FormField } from "../../../components/form-field.js";
import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { AwakeModelsGate } from "../../sessions/components/awake-models-gate.js";
import {
  type Choice,
  OptionPicker,
} from "../../sessions/components/model-settings-panel.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { StoredPairSummary } from "../../sessions/components/stored-pair-summary.js";
import { nextSlots } from "../../sessions/lib/subagent-choice.js";
import {
  useHasHarnessDefault,
  useScheduleDefault,
  useSessionModelChoices,
} from "../api/session-model.js";
import {
  DAYS_ISO,
  daysSummary,
  formatTime12,
  RUN_OPTIONS,
  TIME_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../lib/schedule-form-options.js";
import {
  buildRRuleParts,
  errorField,
  scheduleFields,
  type ScheduleFormValues,
  scheduleSlots,
} from "./schedule-form-schema.js";

const SESSION_TOOLTIP =
  "Fresh starts a new session each run. Continuous resumes one ongoing session, keeping context across runs.";

const PRECHECK_HINT =
  "A shell command run in the agent's workspace before each run. Exit 0 runs the task, exit 1 skips this run, and any other exit runs it anyway. What it prints is added to the prompt.";

const PRECHECK_NOTE = "A command that decides whether each run goes ahead.";

const PRECHECK_PLACEHOLDER =
  "git fetch -q && git log --oneline HEAD..origin/main | grep -q .";

interface FieldsProps {
  control: Control<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
  errors: FieldErrors<ScheduleFormValues>;
  values: ScheduleFormValues;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one setting on one row: its label on the left, its value on the right, as
 * every schedule form lays its settings out.
 */
export function ScheduleRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex min-h-7 items-center justify-between gap-4">
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-foreground">
          {label}
          {hint}
        </span>
        <div className="flex min-w-0 justify-end">{children}</div>
      </div>
      {error && (
        <div className="mt-1 flex justify-end">
          <FormError message={error} />
        </div>
      )}
    </div>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a labelled, bordered group of schedule rows inside a dialog. */
export function ScheduleRowGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {children}
      </div>
    </div>
  );
}

export function RowHint({
  content,
  label,
}: {
  content: string;
  label: string;
}) {
  return (
    <HintTooltip
      content={content}
      label={label}
      side="top"
      className="text-muted-foreground"
    >
      <Information size={14} />
    </HintTooltip>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a dropdown that sits on a row as its value: as wide as what it shows, its arrow right beside it. */
export function RowSelect({
  className,
  ...props
}: React.ComponentProps<typeof Select>) {
  return (
    <div className="w-fit">
      <Select
        variant="ghost"
        className={cn(
          "h-7 w-auto field-sizing-content py-0 pr-7 pl-2 text-right text-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function DaysPicker({
  value,
  onChange,
  invalid,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  invalid: boolean;
}) {
  const summary = daysSummary(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Days: ${summary ?? "Pick days"}`}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex h-7 items-center rounded-md border border-transparent pr-3 pl-2 text-sm text-foreground hover:bg-background",
            invalid && "border-danger text-danger",
          )}
        >
          {summary ?? "Pick days"}
          <ChevronDown size={16} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        {DAYS_ISO.map((d) => (
          <DropdownMenuCheckboxItem
            key={d.iso}
            checked={value.includes(d.iso)}
            onCheckedChange={() =>
              onChange(
                value.includes(d.iso)
                  ? value.filter((v) => v !== d.iso)
                  : [...value, d.iso].sort(),
              )
            }
            onSelect={(e) => e.preventDefault()}
          >
            {d.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ScheduleRecurrenceFields({
  control,
  register,
  errors,
  values,
}: FieldsProps) {
  const cadence = buildRRuleParts(values);
  const cadenceError = (field: ReturnType<typeof errorField>) =>
    cadence.error && errorField(values.kind) === field
      ? { error: cadence.error }
      : {};

  const timeOptions = TIME_OPTIONS.some((o) => o.value === values.time)
    ? TIME_OPTIONS
    : [
        { value: values.time, label: formatTime12(values.time) },
        ...TIME_OPTIONS,
      ];

  return (
    <>
      <ScheduleRow label="Repeat" {...cadenceError("kind")}>
        <RowSelect aria-label="Repeat" {...register("kind")}>
          {RUN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </RowSelect>
      </ScheduleRow>

      {values.kind === "daily" && (
        <ScheduleRow label="Time">
          <RowSelect aria-label="Time" {...register("time")}>
            {timeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </RowSelect>
        </ScheduleRow>
      )}

      {(values.kind === "minutely" || values.kind === "hourly") && (
        <ScheduleRow label="Every" {...cadenceError("interval")}>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Input
              type="number"
              min={1}
              size="sm"
              aria-label="Every"
              className="w-16 text-sm"
              variant={cadence.error ? "invalid" : undefined}
              {...register("interval")}
            />
            <span>{values.kind === "minutely" ? "minutes" : "hours"}</span>
          </div>
        </ScheduleRow>
      )}

      {values.kind !== "custom" && (
        <ScheduleRow
          label="Days"
          {...(errors.days?.message ? { error: errors.days.message } : {})}
        >
          <Controller
            control={control}
            name="days"
            render={({ field }) => (
              <DaysPicker
                value={field.value}
                onChange={field.onChange}
                invalid={field.value.length === 0}
              />
            )}
          />
        </ScheduleRow>
      )}

      {values.kind === "custom" && (
        <ScheduleRow label="RRULE" {...cadenceError("customRRule")}>
          <Input
            size="sm"
            aria-label="RRULE"
            className="w-[260px] font-mono"
            variant={cadence.error ? "invalid" : undefined}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"
            {...register("customRRule")}
          />
        </ScheduleRow>
      )}

      <ScheduleRow
        label="Timezone"
        {...(errors.timezone?.message
          ? { error: errors.timezone.message }
          : {})}
      >
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <SearchableSelect
              value={field.value}
              onChange={field.onChange}
              options={TIMEZONE_OPTIONS}
              placeholder="Select a timezone"
              invalid={!!errors.timezone}
              className="h-7 w-auto gap-0 border-transparent bg-transparent pr-3 pl-2 hover:bg-background"
              listClassName="right-0 w-[280px]"
            />
          )}
        />
      </ScheduleRow>
    </>
  );
}

export function ScheduleSessionTypeField<T extends FieldValues>({
  control,
}: {
  control: Control<T>;
}) {
  return (
    <ScheduleRow
      label="Session type"
      hint={<RowHint content={SESSION_TOOLTIP} label="About session types" />}
    >
      <Controller
        control={control}
        name={"sessionMode" as Path<T>}
        render={({ field }) => (
          <RowSelect
            aria-label="Session type"
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
          >
            <option value="fresh">Fresh</option>
            <option value="continuous">Continuous</option>
          </RowSelect>
        )}
      />
    </ScheduleRow>
  );
}

interface PrecheckFieldProps {
  layout: "stacked" | "rows";
  registration: UseFormRegisterReturn;
  error?: string | undefined;
  /** UNIT_BOUNDARY_DESCRIPTION: on a row, whether the box shows from the start: a precheck already set does, an empty one waits for Add. */
  defaultOpen?: boolean;
}

export function SchedulePrecheckField({
  layout,
  registration,
  error,
  defaultOpen = false,
}: PrecheckFieldProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const input = (
    <Textarea
      id={fieldId}
      className="min-h-[56px] resize-y font-mono text-xs"
      variant={error ? "invalid" : undefined}
      placeholder={PRECHECK_PLACEHOLDER}
      rows={2}
      {...registration}
    />
  );

  if (layout === "stacked")
    return (
      <FormField label="Precheck (optional)" error={error} hint={PRECHECK_HINT}>
        {input}
      </FormField>
    );

  return (
    <>
      <div className="px-4 py-3">
        <div className="flex min-h-7 items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-sm text-foreground">
            <label htmlFor={fieldId}>Precheck</label>
            <RowHint content={PRECHECK_HINT} label="About prechecks" />
          </span>
          {!open && (
            <RowAddButton
              label="Add a precheck"
              onClick={() => {
                flushSync(() => setOpen(true));
                document.getElementById(fieldId)?.focus();
              }}
            />
          )}
        </div>
        <RowNote>{PRECHECK_NOTE}</RowNote>
      </div>
      <div hidden={!open} className="bg-muted/30 px-4 py-3">
        {input}
        <FormError message={error} />
      </div>
    </>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the one line under a row's label that says what the setting does, visible where a tooltip cannot open, as on a touch screen. */
export function RowNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>;
}

/** UNIT_BOUNDARY_DESCRIPTION: the inline "+ Add" a row shows on its right while it has nothing yet. */
export function RowAddButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      className="h-7 gap-1.5 pr-3 pl-2 text-muted-foreground"
      onClick={onClick}
    >
      <Add size={16} />
      Add
    </Button>
  );
}

const MODEL_HINT =
  "Default is the harness's own default; where the agent has none, a schedule without a model follows the agent's model.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod.
 * The single model field of a schedule: a bare name from the agent's list.
 */
export function ScheduleModelField({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: string;
  onChange: (model: string) => void;
}) {
  const choices = useSessionModelChoices(agentId || null);
  const hasDefault = useHasHarnessDefault(agentId || null);
  const supported = choices.length > 0;
  if (!supported && !value) return null;
  const options: Choice[] = choices.map((c) => ({
    id: c.value,
    name: c.name,
    description: c.description,
  }));
  if (value && !options.some((c) => c.id === value))
    options.push({
      id: value,
      name: value,
      description: supported
        ? "Not in this agent's model list"
        : "This agent can't switch a session's model; clear it so runs follow the agent",
    });

  return (
    <FormField label="Model" hint={MODEL_HINT}>
      <OptionPicker
        title="Model"
        choices={options}
        value={value || null}
        clearable
        {...(hasDefault
          ? {}
          : {
              placeholder: "Same as agent",
              clearedLabel: "Same as agent",
              clearedDescription: "Follows the model the agent is set to",
            })}
        onSelect={(id) => onChange(id ?? "")}
      />
    </FormField>
  );
}

const SESSION_TITLE_HINT =
  "Shown in the session list instead of the title the agent derives from the prompt. Every run of a fresh schedule gets the same title.";

export function ScheduleSessionTitleField({
  registration,
  error,
}: {
  registration: UseFormRegisterReturn;
  error?: string | undefined;
}) {
  return (
    <FormField
      label="Session title (optional)"
      error={error}
      hint={SESSION_TITLE_HINT}
    >
      <Input
        variant={error ? "invalid" : undefined}
        placeholder="Derived from the prompt"
        {...registration}
      />
    </FormField>
  );
}

interface ChoicesControl {
  harness: string;
  model: string;
  settings: Record<string, string>;
  profile: string;
  platformSubagentProfile: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a schedule runs on (D92), picked with the
 * chat's own picker in both slots and kept in the form's fields: the primary a
 * profile or the harness, model and settings of its own, the subagent a
 * profile or the platform sub-agent values its settings carry. Empty primary
 * fields are the scheduled default — what the agent's Schedules page picks,
 * which the chat default answers until it does — kept empty by any schedule
 * that follows it, saying what it is now in the hint. On a runtime without the
 * Model Router the old single model field stands.
 */
export function ScheduleChoicesField<T extends ChoicesControl>({
  agentId,
  control,
  migrationNote,
}: {
  agentId: string;
  control: Control<T>;
  migrationNote: string | null;
}) {
  const typed = control as unknown as Control<ChoicesControl>;
  const { data: status } = useHarnessConfigStatus(agentId || null);
  const agentOperable = useIsAgentOperable(agentId || null);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const routed = status?.modelRouter ?? false;
  const { field: profileField } = useController({
    control: typed,
    name: "profile",
  });
  const { field: harnessField } = useController({
    control: typed,
    name: "harness",
  });
  const { field: modelField, fieldState: modelState } = useController({
    control: typed,
    name: "model",
  });
  const { field: settingsField } = useController({
    control: typed,
    name: "settings",
  });
  const { field: subagentField } = useController({
    control: typed,
    name: "platformSubagentProfile",
  });
  const { data: fallback } = useScheduleDefault(
    routed && agentId ? agentId : null,
    null,
  );
  const listedByRunningAgent =
    !status?.harnesses ||
    (!routed && status.sessionModel && !!status.defaultHarness);
  if (agentId && status && !agentOperable && listedByRunningAgent)
    return (
      <FormField label="Model">
        <AwakeModelsGate agentId={agentId} />
      </FormField>
    );
  if (!routed)
    return (
      <ScheduleModelField
        agentId={agentId}
        value={modelField.value}
        onChange={modelField.onChange}
      />
    );
  const slots = scheduleSlots({
    profile: profileField.value,
    harness: harnessField.value,
    model: modelField.value,
    settings: settingsField.value ?? {},
    platformSubagentProfile: subagentField.value,
  });
  const follows = !slots.profileId && !harnessField.value && !modelField.value;
  /* UNIT_BOUNDARY_DESCRIPTION: with nothing picked, the panel opens on what the
   * schedule follows, its own harness first, so its Provider row names the
   * Connection that default runs on. */
  const defaultHarness = fallback?.harness ?? status?.defaultHarness ?? "";
  return (
    <div role="group" aria-label="Runs on" className="flex flex-col gap-2">
      <SectionLabel>Runs on</SectionLabel>
      <SessionPairPicker
        agentId={agentId}
        carried={status?.harnesses ?? []}
        defaultHarness={defaultHarness}
        routed
        onConnectProviders={() =>
          agentId && navigateToSandboxHome(agentId, "providers")
        }
        target={{
          slots,
          label: "Schedule harness and model",
          placeholder: "The agent's model for schedules",
          defaultPair: fallback ?? null,
          onChoose: (pair, references) => {
            const next = scheduleFields(
              nextSlots(slots, pair, references),
              pair,
            );
            profileField.onChange(next.profile);
            harnessField.onChange(next.harness);
            modelField.onChange(next.model);
            settingsField.onChange(next.settings);
            subagentField.onChange(next.platformSubagentProfile);
          },
        }}
      />
      {!follows && (
        <button
          type="button"
          onClick={() => {
            profileField.onChange("");
            harnessField.onChange("");
            modelField.onChange("");
            settingsField.onChange({});
            subagentField.onChange("");
          }}
          className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Use the agent's model for schedules
        </button>
      )}
      <span className="text-sm text-muted-foreground">
        {follows ? (
          <>
            This schedule follows the agent&apos;s model for schedules
            {fallback?.model && (
              <>
                {" (now: "}
                <span className="inline-flex items-center gap-1 align-bottom">
                  <StoredPairSummary
                    agentId={agentId}
                    harness={fallback.harness}
                    model={fallback.model}
                    settings={fallback.settings ?? {}}
                  />
                </span>
                {")"}
              </>
            )}
            , which the agent&apos;s Schedules page sets. Pick a profile or a
            model to give it values of its own.
          </>
        ) : (
          "What this schedule runs on, picked as a chat's model is. Editing a profile changes every schedule that names it; a pick of its own applies to this schedule only."
        )}
      </span>
      <FormError
        message={modelState.error?.message ?? migrationNote ?? undefined}
      />
    </div>
  );
}
