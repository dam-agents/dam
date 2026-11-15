import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";

import { DisclosureToggle } from "@/components/ui/disclosure";

import { emitToast } from "../../../lib/toast.js";
import type { Schedule } from "../../../types.js";
import { useCreateSchedule, useUpdateSchedule } from "../api/mutations.js";
import type { CreatedSchedule } from "../lib/just-ask.js";
import { QuietHoursEditor } from "./quiet-hours-editor.js";
import { ScheduleDialog } from "./schedule-dialog.js";
import {
  SchedulePrecheckField,
  ScheduleRecurrenceFields,
  ScheduleRowGroup,
  ScheduleSessionTitleField,
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

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: { ...scheduleFormDefaults(existing), ...draft },
  });
  const { errors } = form.formState;
  const values = form.watch();
  /* UNIT_BOUNDARY_DESCRIPTION: a schedule that already carries one of the folded fields opens them, so nothing set is hidden behind More options; a new one starts closed. */
  const [moreOptions, setMoreOptions] = useState(() => {
    const v = form.getValues();
    return (
      v.sessionMode !== "fresh" ||
      v.quietHours.length > 0 ||
      v.precheck.trim() !== "" ||
      v.sessionTitle.trim() !== ""
    );
  });

  const { summary } = buildRRuleParts(values);
  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;
  /* UNIT_BOUNDARY_DESCRIPTION: a folded field whose value the form refuses opens them again, or a refusal would leave Create doing nothing while its reason sits in a closed section. */
  const detailsError = Boolean(
    quietHoursError || errors.precheck || errors.sessionTitle,
  );
  const showMore = moreOptions || detailsError;

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
        noun: "schedule",
        confirmLabel: "Delete schedule",
        buttonLabel: "Delete",
      }}
      leadingFields={leadingFields}
      extraFields={
        <>
          <ScheduleRowGroup label="Frequency">
            <ScheduleRecurrenceFields
              control={form.control}
              register={form.register}
              errors={errors}
              values={values}
            />
          </ScheduleRowGroup>
          {summary && (
            <p className="-mt-2 text-sm text-muted-foreground">{summary}</p>
          )}
        </>
      }
      afterChoices={
        <>
          <DisclosureToggle
            open={showMore}
            onToggle={() => setMoreOptions(!showMore)}
            chevronSize={14}
            testId="schedule-more-options"
            className="self-start text-[13px] text-muted-foreground hover:text-foreground"
          >
            More options
          </DisclosureToggle>
          {showMore && (
            <>
              <ScheduleRowGroup label="Options">
                <ScheduleSessionTypeField control={form.control} />
                <QuietHoursEditor
                  control={form.control}
                  register={form.register}
                  error={quietHoursError}
                />
              </ScheduleRowGroup>
              <SchedulePrecheckField
                layout="stacked"
                registration={form.register("precheck")}
                error={errors.precheck?.message}
              />
              <ScheduleSessionTitleField
                registration={form.register("sessionTitle")}
                error={errors.sessionTitle?.message}
              />
            </>
          )}
        </>
      }
    />
  );
}
