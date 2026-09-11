import { ChevronDown, Close, Information } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { DialogActions, DialogBody, Modal } from "@/components/modal";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { HintTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import {
  useCreateSchedule,
  useDeleteSchedule,
  useToggleSchedule,
  useUpdateSchedule,
} from "../api/mutations.js";
import {
  formatTime12,
  RUN_OPTIONS,
  TIME_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../lib/schedule-form-options.js";
import { QuietHoursRows } from "./quiet-hours-editor.js";
import {
  buildRRuleParts,
  scheduleFormDefaults,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "./schedule-form-schema.js";

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

interface Props {
  agentId?: string;
  agentName?: string;
  agentChoices?: readonly { id: string; name: string }[];
  existing?: Schedule;
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleFormModal({
  agentId,
  agentName,
  agentChoices,
  existing,
  onClose,
  onSaved,
}: Props) {
  const [chosenAgent, setChosenAgent] = useState(agentId ?? "");
  const targetAgentId = existing?.agentId ?? agentId ?? chosenAgent;
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const toggleSchedule = useToggleSchedule();
  const showConfirm = useStore((state) => state.showConfirm);
  const selectAgent = useStore((s) => s.selectAgent);
  const mutation = existing ? updateSchedule : createSchedule;

  const handleDelete = async () => {
    if (!existing) return;
    const confirmed = await showConfirm(
      "Are you sure you want to delete this schedule?",
      `Delete ${existing.name}?`,
      { kind: "destructive", confirmLabel: "Delete Schedule" },
    );
    if (!confirmed) return;
    deleteSchedule.mutate({ id: existing.id });
    onClose();
  };

  const { control, register, handleSubmit, watch, formState } =
    useForm<ScheduleFormValues>({
      resolver: zodResolver(scheduleFormSchema),
      defaultValues: scheduleFormDefaults(existing),
    });
  const { errors } = formState;

  const values = watch();
  const cadence = buildRRuleParts(values);

  const timeOptions = TIME_OPTIONS.some((o) => o.value === values.time)
    ? TIME_OPTIONS
    : [
        { value: values.time, label: formatTime12(values.time) },
        ...TIME_OPTIONS,
      ];

  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;

  const onSubmit = handleSubmit((v) => {
    const common = {
      name: v.name,
      rrule: buildRRuleParts(v).body,
      timezone: v.timezone,
      quietHours: v.quietHours,
      task: v.task,
      sessionMode: v.sessionMode,
    };
    const onSuccess = () => {
      emitToast({
        kind: "success",
        message: existing
          ? `Schedule "${v.name}" saved`
          : `Schedule "${v.name}" added`,
      });
      onSaved();
      onClose();
    };
    if (existing) {
      updateSchedule.mutate({ id: existing.id, ...common }, { onSuccess });
    } else {
      createSchedule.mutate(
        { agentId: targetAgentId, ...common },
        { onSuccess },
      );
    }
  });

  const isEditing = !!existing;

  return (
    <Modal>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        {/* Header */}
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

          {isEditing && agentName && (
            <button
              type="button"
              className="mb-1 text-[14px] font-medium text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => {
                onClose();
                selectAgent(existing.agentId);
              }}
            >
              {agentName}
            </button>
          )}

          {isEditing ? (
            <div className="flex items-center justify-between gap-4 pr-8">
              <Input
                className="h-auto border-none bg-transparent p-0 text-lg font-semibold text-foreground shadow-none focus-visible:ring-0"
                {...register("name")}
              />
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[14px] text-muted-foreground">
                  {existing.enabled ? "Active" : "Inactive"}
                </span>
                <Switch
                  checked={existing.enabled}
                  onCheckedChange={() =>
                    toggleSchedule.mutate({ id: existing.id })
                  }
                  label={
                    existing.enabled ? "Disable schedule" : "Enable schedule"
                  }
                />
              </div>
            </div>
          ) : (
            <h2 className="text-lg font-semibold text-foreground">
              Create a new schedule
            </h2>
          )}
        </div>

        <DialogBody className="flex flex-col gap-6">
          {/* Agent selector — create only */}
          {!isEditing && agentChoices && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Agent</SectionLabel>
              <Select
                className="h-10"
                value={chosenAgent}
                onChange={(event) => setChosenAgent(event.target.value)}
              >
                <option value="" disabled>
                  Choose an agent
                </option>
                {agentChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Name — create only */}
          {!isEditing && (
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

          {/* Prompt */}
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

          {/* Frequency */}
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

          {/* Options */}
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
          leading={
            isEditing ? (
              <Button
                type="button"
                variant="ghost"
                tone="danger"
                className="text-danger"
                disabled={deleteSchedule.isPending}
                onClick={() => void handleDelete()}
              >
                Delete
              </Button>
            ) : undefined
          }
          onCancel={onClose}
          label={isEditing ? "Save" : "Create"}
          pendingLabel={isEditing ? "Saving…" : "Creating…"}
          pending={mutation.isPending}
          disabled={!targetAgentId}
        />
      </form>
    </Modal>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="shrink-0 text-[14px] text-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
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
