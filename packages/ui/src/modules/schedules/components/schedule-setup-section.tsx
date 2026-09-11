import {
  Add,
  ChevronDown,
  Close,
  Information,
  OverflowMenuVertical,
  Pause,
  Time,
} from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { DialogActions, DialogBody, Modal } from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { HintTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import type { ScheduleDraft } from "../../sandboxes/hooks/use-setup-form.js";
import { QuietHoursRows } from "../forms/quiet-hours-editor.js";
import {
  buildRRuleParts,
  scheduleFormDefaults,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "../forms/schedule-form-schema.js";
import {
  formatTime12,
  RUN_OPTIONS,
  TIME_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../lib/schedule-form-options.js";

export interface PresetRecommendation {
  summary: string;
  fields?: Partial<
    Record<"time" | "days" | "kind" | "timezone" | "sessionMode", string>
  >;
}

interface Props {
  drafts: ScheduleDraft[];
  onDraftsChange: (drafts: ScheduleDraft[]) => void;
  presetIndices?: Set<number>;
}

export function ScheduleSetupSection({
  drafts,
  onDraftsChange,
  presetIndices,
}: Props) {
  const [modalState, setModalState] = useState<
    { mode: "create" } | { mode: "edit"; index: number } | null
  >(null);

  const handleCreate = (values: ScheduleFormValues) => {
    onDraftsChange([...drafts, { ...values, enabled: true }]);
    setModalState(null);
  };

  const handleEdit = (index: number, values: ScheduleFormValues) => {
    const next = [...drafts];
    next[index] = { ...values, enabled: drafts[index]!.enabled ?? true };
    onDraftsChange(next);
    setModalState(null);
  };

  const handleDelete = (index: number) => {
    onDraftsChange(drafts.filter((_, i) => i !== index));
  };

  const handleToggle = (index: number) => {
    const next = [...drafts];
    const d = next[index]!;
    next[index] = { ...d, enabled: !(d.enabled ?? true) };
    onDraftsChange(next);
  };

  const handleDraftChange = (index: number, values: ScheduleFormValues) => {
    const next = [...drafts];
    next[index] = { ...values, enabled: drafts[index]!.enabled ?? true };
    onDraftsChange(next);
  };

  if (drafts.length === 0) {
    return (
      <section className="mb-8">
        <SectionLabel spaced>
          Schedule{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </SectionLabel>
        <Callout inset className="bg-card">
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-center text-sm text-foreground/80">
              Automate this agent on a recurring schedule,
              <br />
              you can also create schedules by chatting with your agent
            </p>
            <Button
              variant="outline"
              onClick={() => setModalState({ mode: "create" })}
            >
              <Time size={16} />
              Create schedule
            </Button>
          </div>
        </Callout>
        {modalState?.mode === "create" && (
          <ScheduleSetupModal
            onClose={() => setModalState(null)}
            onSave={handleCreate}
          />
        )}
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Schedules</SectionLabel>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setModalState({ mode: "create" })}
        >
          <Add size={16} />
          Create Schedule
        </Button>
      </div>

      <Inset className="flex flex-col gap-1.5">
        {drafts.map((draft, index) => {
          const isPreset = presetIndices?.has(index) ?? false;

          if (isPreset) {
            return (
              <PresetScheduleCard
                key={index}
                draft={draft}
                recommendation={getRecommendation(draft)}
                onDraftChange={(values) => handleDraftChange(index, values)}
                onDelete={() => handleDelete(index)}
                onToggle={() => handleToggle(index)}
              />
            );
          }

          return (
            <CompactScheduleCard
              key={index}
              draft={draft}
              onEdit={() => setModalState({ mode: "edit", index })}
              onDelete={() => handleDelete(index)}
              onToggle={() => handleToggle(index)}
            />
          );
        })}
      </Inset>
      {modalState?.mode === "create" && (
        <ScheduleSetupModal
          onClose={() => setModalState(null)}
          onSave={handleCreate}
        />
      )}
      {modalState?.mode === "edit" && (
        <ScheduleSetupModal
          initial={drafts[modalState.index]}
          onClose={() => setModalState(null)}
          onSave={(values) => handleEdit(modalState.index, values)}
        />
      )}
    </section>
  );
}

function getRecommendation(draft: ScheduleDraft): PresetRecommendation {
  const ext = draft as ScheduleDraft & {
    hint?: string;
    recommendation?: PresetRecommendation;
  };
  if (ext.recommendation) return ext.recommendation;
  return {
    summary: ext.hint ?? "Adjust the schedule to fit your workflow",
    fields: {
      time: "Before your first meeting of the day",
      days: "Workdays, when your team is active",
    },
  };
}

function CompactScheduleCard({
  draft,
  onEdit,
  onDelete,
  onToggle,
}: {
  draft: ScheduleDraft;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const enabled = draft.enabled ?? true;
  const cadence = buildRRuleParts(draft);

  return (
    <div
      className={cn(
        CARD_SURFACE,
        CARD_HOVER,
        "group flex items-center gap-4 rounded-xl px-4 py-3",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          enabled
            ? "bg-blue-100/50 text-accent dark:bg-blue-950/50"
            : "bg-muted text-muted-foreground",
        )}
      >
        {enabled ? <Time size={16} /> : <Pause size={16} />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground">
          {draft.name || "Untitled schedule"}
        </p>
        {cadence.summary && (
          <p className="truncate text-[14px] text-muted-foreground">
            {cadence.summary}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          label={enabled ? "Disable schedule" : "Enable schedule"}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Schedule actions"
            >
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>Edit schedule</DropdownMenuItem>
            <DropdownMenuItem tone="danger" onSelect={onDelete}>
              Delete schedule
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function PresetScheduleCard({
  draft,
  recommendation,
  onDraftChange,
  onDelete,
  onToggle,
}: {
  draft: ScheduleDraft;
  recommendation: PresetRecommendation;
  onDraftChange: (values: ScheduleFormValues) => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const enabled = draft.enabled ?? true;
  const cadence = buildRRuleParts(draft);

  const { control, register, watch } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      name: draft.name,
      task: draft.task,
      timezone: draft.timezone,
      sessionMode: draft.sessionMode,
      kind: draft.kind,
      interval: draft.interval,
      time: draft.time,
      days: draft.days,
      customRRule: draft.customRRule,
      quietHours: draft.quietHours,
    },
  });

  const values = watch();

  useEffect(() => {
    const sub = watch((formValues) => {
      onDraftChange(formValues as ScheduleFormValues);
    });
    return () => sub.unsubscribe();
  }, [watch, onDraftChange]);

  const timeOptions = TIME_OPTIONS.some((o) => o.value === values.time)
    ? TIME_OPTIONS
    : [
        { value: values.time, label: formatTime12(values.time) },
        ...TIME_OPTIONS,
      ];

  const frequencyFields = (fieldHints?: PresetRecommendation["fields"]) => (
    <>
      <FieldRow label="Repeat" hint={fieldHints?.kind}>
        <InlineSelect {...register("kind")}>
          {RUN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </InlineSelect>
      </FieldRow>

      {values.kind === "daily" && (
        <FieldRow label="Time" hint={fieldHints?.time}>
          <InlineSelect {...register("time")}>
            {timeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </InlineSelect>
        </FieldRow>
      )}

      {(values.kind === "minutely" || values.kind === "hourly") && (
        <FieldRow label="Interval">
          <div className="flex items-center justify-end gap-1.5 text-[14px]">
            <span className="text-muted-foreground">Every</span>
            <Input
              type="number"
              min={1}
              className="h-auto w-[48px] border-none bg-transparent p-0 text-right text-[14px] shadow-none focus:ring-0"
              {...register("interval")}
            />
            <span className="text-muted-foreground">
              {values.kind === "minutely" ? "min" : "hr"}
            </span>
          </div>
        </FieldRow>
      )}

      {values.kind !== "custom" && (
        <Controller
          control={control}
          name="days"
          render={({ field }) => (
            <FieldRow label="Days" hint={fieldHints?.days}>
              <DayPicker value={field.value} onChange={field.onChange} />
            </FieldRow>
          )}
        />
      )}

      {values.kind === "custom" && (
        <FieldRow label="RRULE">
          <Input
            className="h-auto border-none bg-transparent p-0 text-right font-mono text-[14px] shadow-none focus:ring-0"
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE"
            {...register("customRRule")}
          />
        </FieldRow>
      )}

      <FieldRow label="Timezone" hint={fieldHints?.timezone}>
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <SearchableSelect
              value={field.value}
              onChange={field.onChange}
              options={TIMEZONE_OPTIONS}
              placeholder="Select"
            />
          )}
        />
      </FieldRow>
    </>
  );

  const optionsFields = (fieldHints?: PresetRecommendation["fields"]) => (
    <>
      <FieldRow
        label={
          <span className="flex items-center gap-1.5">
            Session type
            <HintTooltip
              content={SESSION_TOOLTIP}
              label="About session types"
              side="top"
              className="text-muted-foreground"
            >
              <Information size={16} />
            </HintTooltip>
          </span>
        }
        hint={fieldHints?.sessionMode}
      >
        <Controller
          control={control}
          name="sessionMode"
          render={({ field }) => (
            <InlineSelect
              value={field.value}
              onChange={(e) =>
                field.onChange(e.target.value as "fresh" | "continuous")
              }
            >
              <option value="fresh">Fresh</option>
              <option value="continuous">Continuous</option>
            </InlineSelect>
          )}
        />
      </FieldRow>

      <QuietHoursRows control={control} register={register} />
    </>
  );

  const cardHeader = (
    <div className="flex items-center gap-4 px-4 py-3">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          enabled
            ? "bg-preset-border/50 text-preset"
            : "bg-muted text-muted-foreground",
        )}
      >
        {enabled ? <Time size={16} /> : <Pause size={16} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {draft.name || "Untitled schedule"}
          </p>
          <Badge variant="preset">Starter Kit</Badge>
        </div>
        {cadence.summary && (
          <p className="truncate text-[14px] text-muted-foreground">
            {cadence.summary}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          label={enabled ? "Disable schedule" : "Enable schedule"}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={onDelete}
          aria-label="Remove schedule"
        >
          <Close size={16} />
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        CARD_SURFACE,
        "group flex flex-col rounded-xl",
        "border-preset-border/50 bg-preset-light/50",
      )}
    >
      {cardHeader}

      <div className="border-t border-preset-border/30 px-4 py-3">
        <div className="flex items-start gap-2.5 rounded-lg bg-preset-border/50 px-3 py-2.5">
          <Information size={16} className="mt-0.5 shrink-0 text-preset" />
          <p className="text-[14px] leading-relaxed text-foreground/80">
            {recommendation.summary}
          </p>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-preset-border/20 border-t border-preset-border/30">
        {frequencyFields()}
      </div>

      <div className="flex flex-col divide-y divide-preset-border/20 border-t border-preset-border/30">
        {optionsFields()}
      </div>
    </div>
  );
}

const DAYS_ISO: { iso: number; label: string }[] = [
  { iso: 1, label: "Monday" },
  { iso: 2, label: "Tuesday" },
  { iso: 3, label: "Wednesday" },
  { iso: 4, label: "Thursday" },
  { iso: 5, label: "Friday" },
  { iso: 6, label: "Saturday" },
  { iso: 7, label: "Sunday" },
];

const SHORT_DAYS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

function formatSelectedDays(days: number[]): string {
  if (days.length === 0) return "None";
  if (days.length === 7) return "Every day";
  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [6, 7];
  if (days.length === 5 && weekdays.every((d) => days.includes(d)))
    return "Weekdays";
  if (days.length === 2 && weekend.every((d) => days.includes(d)))
    return "Weekends";
  return days.map((d) => SHORT_DAYS[d]).join(", ");
}

const SESSION_TOOLTIP =
  "Fresh starts a new session each run. Continuous resumes one ongoing session, keeping context across runs.";

function ScheduleSetupModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: ScheduleFormValues | null;
  onClose: () => void;
  onSave: (values: ScheduleFormValues) => void;
}) {
  const { control, register, handleSubmit, watch, formState } =
    useForm<ScheduleFormValues>({
      resolver: zodResolver(scheduleFormSchema),
      defaultValues: initial ? initial : scheduleFormDefaults(),
    });
  const { errors } = formState;

  const values = watch();

  const timeOptions = TIME_OPTIONS.some((o) => o.value === values.time)
    ? TIME_OPTIONS
    : [
        { value: values.time, label: formatTime12(values.time) },
        ...TIME_OPTIONS,
      ];

  const cadence = buildRRuleParts(values);
  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;

  const onSubmit = handleSubmit((v) => onSave(v));

  return (
    <Modal>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        <div className="relative px-5 pt-5 pb-4 md:px-7 md:pt-7">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-5 right-5 text-muted-foreground md:top-5 md:right-5"
          >
            <Close size={16} />
          </Button>
          <h2 className="text-lg font-semibold text-foreground">
            {initial ? "Edit schedule" : "Create a new schedule"}
          </h2>
        </div>

        <DialogBody className="flex flex-col gap-6">
          {!initial && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Name</SectionLabel>
              <Input
                className="h-10"
                variant={errors.name ? "invalid" : undefined}
                placeholder="Schedule name"
                {...register("name")}
              />
              <FormError message={errors.name?.message} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <SectionLabel>Prompt</SectionLabel>
            <Textarea
              className="min-h-[100px] resize-y"
              variant={errors.task ? "invalid" : undefined}
              placeholder="Enter a task prompt"
              rows={4}
              {...register("task")}
            />
            <FormError message={errors.task?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Frequency</SectionLabel>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              <FieldRow label="Repeat">
                <InlineSelect {...register("kind")}>
                  {RUN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </InlineSelect>
              </FieldRow>

              {values.kind === "daily" && (
                <FieldRow label="Time">
                  <InlineSelect {...register("time")}>
                    {timeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </InlineSelect>
                </FieldRow>
              )}

              {(values.kind === "minutely" || values.kind === "hourly") && (
                <FieldRow label="Interval">
                  <div className="flex items-center justify-end gap-1.5 text-[14px]">
                    <span className="text-muted-foreground">Every</span>
                    <Input
                      type="number"
                      min={1}
                      className="h-auto w-[48px] border-none bg-transparent p-0 text-right text-[14px] shadow-none focus:ring-0"
                      variant={errors.interval ? "invalid" : undefined}
                      {...register("interval")}
                    />
                    <span className="text-muted-foreground">
                      {values.kind === "minutely" ? "min" : "hr"}
                    </span>
                  </div>
                </FieldRow>
              )}

              {values.kind !== "custom" && (
                <Controller
                  control={control}
                  name="days"
                  render={({ field }) => (
                    <FieldRow label="Days">
                      <DayPicker
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FieldRow>
                  )}
                />
              )}

              {values.kind === "custom" && (
                <FieldRow label="RRULE">
                  <Input
                    className="h-auto border-none bg-transparent p-0 text-right font-mono text-[14px] shadow-none focus:ring-0"
                    variant={cadence.error ? "invalid" : undefined}
                    placeholder="FREQ=WEEKLY;BYDAY=MO,WE"
                    {...register("customRRule")}
                  />
                </FieldRow>
              )}

              <FieldRow label="Timezone">
                <Controller
                  control={control}
                  name="timezone"
                  render={({ field }) => (
                    <SearchableSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={TIMEZONE_OPTIONS}
                      placeholder="Select"
                      invalid={!!errors.timezone}
                    />
                  )}
                />
              </FieldRow>
            </div>

            {cadence.error && <FormError message={cadence.error} />}
            <FormError message={errors.days?.message} />
            <FormError message={errors.interval?.message} />
            <FormError message={errors.timezone?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Options</SectionLabel>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              <FieldRow
                label={
                  <span className="flex items-center gap-1.5">
                    Session type
                    <HintTooltip
                      content={SESSION_TOOLTIP}
                      label="About session types"
                      side="top"
                      className="text-muted-foreground"
                    >
                      <Information size={16} />
                    </HintTooltip>
                  </span>
                }
              >
                <Controller
                  control={control}
                  name="sessionMode"
                  render={({ field }) => (
                    <InlineSelect
                      value={field.value}
                      onChange={(e) =>
                        field.onChange(e.target.value as "fresh" | "continuous")
                      }
                    >
                      <option value="fresh">Fresh</option>
                      <option value="continuous">Continuous</option>
                    </InlineSelect>
                  )}
                />
              </FieldRow>

              <QuietHoursRows control={control} register={register} />
            </div>
            <FormError message={quietHoursError} />
          </div>
        </DialogBody>

        <DialogActions
          onCancel={onClose}
          label={initial ? "Save" : "Create"}
          pendingLabel="Saving…"
        />
      </form>
    </Modal>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="shrink-0 text-[14px] text-foreground">{label}</span>
        <div className="min-w-0">{children}</div>
      </div>
      {hint && (
        <div className="px-4 pb-2.5 -mt-1">
          <p className="text-[14px] leading-snug text-preset/60">{hint}</p>
        </div>
      )}
    </div>
  );
}

const InlineSelect = ({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Select>) => (
  <Select
    className={cn(
      "h-auto w-auto border-none bg-transparent py-0 pr-7 pl-2 text-right text-[14px] shadow-none focus:ring-0",
      className,
    )}
    {...props}
  >
    {children}
  </Select>
);

function DayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const summary = formatSelectedDays(value);

  const toggle = (iso: number) => {
    onChange(
      value.includes(iso)
        ? value.filter((v) => v !== iso)
        : [...value, iso].sort(),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 text-[14px] text-foreground hover:text-accent"
        >
          {summary}
          <ChevronDown size={16} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        {DAYS_ISO.map((d) => (
          <DropdownMenuCheckboxItem
            key={d.iso}
            checked={value.includes(d.iso)}
            onCheckedChange={() => toggle(d.iso)}
            onSelect={(e) => e.preventDefault()}
          >
            {d.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
