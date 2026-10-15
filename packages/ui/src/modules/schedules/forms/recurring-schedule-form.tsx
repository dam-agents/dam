import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect } from "react";
import { useForm } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { DialogActions, DialogBody, DialogHeader } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import {
  useCreateSchedule,
  useDeleteSchedule,
  useUpdateSchedule,
} from "../api/mutations.js";
import { QuietHoursEditor } from "./quiet-hours-editor.js";
import {
  ScheduleChoicesField,
  SchedulePrecheckField,
  ScheduleRecurrenceFields,
  ScheduleSessionTitleField,
  ScheduleSessionTypeField,
} from "./schedule-fields.js";
import {
  buildRRuleParts,
  scheduleFormDefaults,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "./schedule-form-schema.js";
import type { ScheduleDraft } from "./schedule-kind-field.js";

interface Props {
  agentId: string;
  existing?: Schedule;
  draft?: ScheduleDraft;
  onDraftChange?: (draft: ScheduleDraft) => void;
  leadingFields?: ReactNode;
  onClose: () => void;
}

export function RecurringScheduleForm({
  agentId,
  existing,
  draft,
  onDraftChange,
  leadingFields,
  onClose,
}: Props) {
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const showConfirm = useStore((state) => state.showConfirm);
  const mutation = existing ? updateSchedule : createSchedule;

  const handleDelete = async () => {
    if (!existing) return;
    const confirmed = await showConfirm(
      "It stops running and cannot be recovered.",
      `Delete ${existing.name}?`,
      { kind: "destructive", confirmLabel: "Delete schedule" },
    );
    if (!confirmed) return;
    deleteSchedule.mutate({ id: existing.id });
    onClose();
  };

  const { control, register, handleSubmit, watch, formState } =
    useForm<ScheduleFormValues>({
      resolver: zodResolver(scheduleFormSchema),
      defaultValues: { ...scheduleFormDefaults(existing), ...draft },
    });
  const { errors } = formState;

  useEffect(() => {
    if (!onDraftChange) return;
    const sub = watch(({ name, task }) =>
      onDraftChange({ name: name ?? "", task: task ?? "" }),
    );
    return () => sub.unsubscribe();
  }, [watch, onDraftChange]);

  const values = watch();

  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;

  const onSubmit = handleSubmit((v) => {
    const precheck = v.precheck.trim();
    const harness = v.harness.trim();
    const model = v.model.trim();
    const settings = Object.fromEntries(
      Object.entries(v.settings).filter(([, value]) => value !== ""),
    );
    const hasSettings = Object.keys(settings).length > 0;
    const sessionTitle = v.sessionTitle.trim();
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
      onClose();
    };
    if (existing) {
      updateSchedule.mutate(
        {
          id: existing.id,
          ...common,
          precheck: precheck || null,
          harness: harness || null,
          model: model || null,
          settings: hasSettings ? settings : null,
          sessionTitle: sessionTitle || null,
        },
        { onSuccess },
      );
    } else {
      createSchedule.mutate(
        {
          agentId,
          ...common,
          ...(precheck ? { precheck } : {}),
          ...(harness ? { harness } : {}),
          ...(model ? { model } : {}),
          ...(hasSettings ? { settings } : {}),
          ...(sessionTitle ? { sessionTitle } : {}),
        },
        { onSuccess },
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
      <DialogHeader
        title={existing ? "Edit schedule" : "New schedule"}
        onClose={onClose}
      />

      <DialogBody className="flex flex-col gap-4">
        {leadingFields}
        <FormField label="Name" error={errors.name?.message}>
          <Input
            variant={errors.name ? "invalid" : undefined}
            placeholder="e.g. Daily brief"
            {...register("name")}
          />
        </FormField>

        <ScheduleRecurrenceFields
          layout="stacked"
          control={control}
          register={register}
          errors={errors}
          values={values}
        />

        <QuietHoursEditor
          control={control}
          register={register}
          error={quietHoursError}
        />

        <FormField label="Prompt" error={errors.task?.message}>
          <Textarea
            className="min-h-[80px] resize-y"
            variant={errors.task ? "invalid" : undefined}
            placeholder="Enter a task prompt"
            rows={3}
            {...register("task")}
          />
        </FormField>

        <ScheduleChoicesField
          agentId={agentId}
          control={control}
          migrationNote={existing?.migrationNote ?? null}
        />

        <SchedulePrecheckField
          layout="stacked"
          registration={register("precheck")}
          error={errors.precheck?.message}
        />

        <ScheduleSessionTypeField layout="stacked" control={control} />

        <ScheduleSessionTitleField
          registration={register("sessionTitle")}
          error={errors.sessionTitle?.message}
        />
      </DialogBody>

      <DialogActions
        leading={
          existing ? (
            <Button
              type="button"
              variant="ghost"
              tone="danger"
              disabled={deleteSchedule.isPending}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          ) : undefined
        }
        onCancel={onClose}
        label={existing ? "Save" : "Create"}
        pendingLabel={existing ? "Saving…" : "Creating…"}
        pending={mutation.isPending}
      />
    </form>
  );
}
