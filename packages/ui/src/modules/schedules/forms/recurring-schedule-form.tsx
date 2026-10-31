import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";

import { emitToast } from "../../../lib/toast.js";
import type { Schedule } from "../../../types.js";
import { useFlowOpened } from "../../usage/lib/ui-telemetry.js";
import { useCreateSchedule, useUpdateSchedule } from "../api/mutations.js";
import type { CreatedSchedule } from "../lib/just-ask.js";
import { QuietHoursEditor } from "./quiet-hours-editor.js";
import { ScheduleDialog } from "./schedule-dialog.js";
import {
  SchedulePrecheckField,
  ScheduleRecurrenceFields,
  ScheduleSessionTypeField,
} from "./schedule-fields.js";
import {
  buildRRuleParts,
  quietHoursChange,
  scheduleChoices,
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
  onDirtyChange?: (dirty: boolean) => void;
  onCreated?: (draft: CreatedSchedule) => void;
}

export function RecurringScheduleForm({
  agentId,
  existing,
  draft,
  onDraftChange,
  leadingFields,
  onClose,
  onDirtyChange,
  onCreated,
}: Props) {
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const mutation = existing ? updateSchedule : createSchedule;
  useFlowOpened("create_schedule", !existing);

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: { ...scheduleFormDefaults(existing), ...draft },
  });
  const { errors } = form.formState;
  const values = form.watch();

  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;

  const onValid = (v: ScheduleFormValues) => {
    const precheck = v.precheck.trim();
    const sessionTitle = v.sessionTitle.trim();
    const common = {
      name: v.name,
      rrule: buildRRuleParts(v).body,
      timezone: v.timezone,
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
      if (!existing)
        onCreated?.({
          rrule: common.rrule,
          timezone: v.timezone,
          task: v.task,
          advanced:
            precheck !== "" ||
            sessionTitle !== "" ||
            v.harness.trim() !== "" ||
            v.model.trim() !== "" ||
            Object.values(v.settings).some((value) => value !== "") ||
            v.quietHours.length > 0 ||
            v.sessionMode !== "fresh",
        });
      onClose();
    };
    if (existing) {
      updateSchedule.mutate(
        {
          id: existing.id,
          ...common,
          ...quietHoursChange(v, existing),
          precheck: precheck || null,
          ...scheduleChoices(v, true),
          sessionTitle: sessionTitle || null,
        },
        { onSuccess },
      );
    } else {
      createSchedule.mutate(
        {
          agentId,
          ...common,
          quietHours: v.quietHours,
          ...(precheck ? { precheck } : {}),
          ...scheduleChoices(v, false),
          ...(sessionTitle ? { sessionTitle } : {}),
        },
        { onSuccess },
      );
    }
  };

  return (
    <ScheduleDialog
      title={existing ? "Edit schedule" : "New schedule"}
      agentId={agentId}
      form={form}
      existing={existing}
      draft={draft}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
      onClose={onClose}
      onValid={onValid}
      pending={mutation.isPending}
      submitLabel={existing ? "Save" : "Create"}
      pendingLabel={existing ? "Saving…" : "Creating…"}
      namePlaceholder="e.g. Daily brief"
      deleteCopy={{
        body: "It stops running and cannot be recovered.",
        confirmLabel: "Delete schedule",
        buttonLabel: "Delete",
      }}
      leadingFields={leadingFields}
      extraFields={
        <>
          <ScheduleRecurrenceFields
            layout="stacked"
            control={form.control}
            register={form.register}
            errors={errors}
            values={values}
          />
          <QuietHoursEditor
            control={form.control}
            register={form.register}
            error={quietHoursError}
          />
        </>
      }
      afterChoices={
        <>
          <SchedulePrecheckField
            layout="stacked"
            registration={form.register("precheck")}
            error={errors.precheck?.message}
          />
          <ScheduleSessionTypeField layout="stacked" control={form.control} />
        </>
      }
    />
  );
}
