import { type ReactNode, useEffect } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { DialogActions, DialogBody, DialogHeader } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useGuardedClose } from "../../sandboxes/hooks/use-guarded-close.js";
import { useDeleteSchedule } from "../api/mutations.js";
import { useSchedulePresetProfile } from "../hooks/use-schedule-preset-profile.js";
import {
  ScheduleChoicesField,
  ScheduleSessionTitleField,
} from "./schedule-fields.js";
import type { ScheduleDraft } from "./schedule-kind-field.js";

type DialogValues = FieldValues & {
  name: string;
  task: string;
  sessionTitle: string;
  harness: string;
  model: string;
  settings: Record<string, string>;
  profile: string;
};

interface DeleteCopy {
  body: string;
  confirmLabel: string;
  buttonLabel: string;
}

export function ScheduleDialog<T extends DialogValues>({
  title,
  agentId,
  form,
  existing,
  draft,
  onDraftChange,
  onDirtyChange,
  onClose,
  onValid,
  leadingFields,
  extraFields,
  afterChoices,
  showSessionFields = true,
  namePlaceholder,
  submitLabel,
  pendingLabel,
  pending,
  deleteCopy,
}: {
  title: string;
  agentId: string;
  form: UseFormReturn<T>;
  existing?: Schedule | undefined;
  draft?: ScheduleDraft | undefined;
  onDraftChange?: ((draft: ScheduleDraft) => void) | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  onClose: () => void;
  onValid: (values: T) => void;
  leadingFields?: ReactNode;
  extraFields?: ReactNode;
  afterChoices?: ReactNode;
  showSessionFields?: boolean;
  namePlaceholder: string;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  deleteCopy: DeleteCopy;
}) {
  const fields = form as unknown as UseFormReturn<DialogValues>;
  const { register, handleSubmit, watch, formState, control } = fields;
  const { errors, isDirty } = formState;
  const deleteSchedule = useDeleteSchedule();
  const showConfirm = useStore((state) => state.showConfirm);

  const preset = useSchedulePresetProfile(agentId, !existing);
  /* UNIT_BOUNDARY_DESCRIPTION: a new schedule starts on a profile (D92), written
   * once the lists are here; the write is not a change the user made, so it
   * never makes an untouched form look edited. */
  useEffect(() => {
    if (preset === null || fields.getValues().profile) return;
    fields.setValue("profile", preset, { shouldDirty: false });
  }, [preset, fields]);

  const unsaved = isDirty || !!draft?.name || !!draft?.task;
  const close = useGuardedClose(unsaved, onClose);
  useEffect(() => onDirtyChange?.(unsaved), [unsaved, onDirtyChange]);

  useEffect(() => {
    if (!onDraftChange) return;
    const sub = watch(({ name, task }) =>
      onDraftChange({ name: name ?? "", task: task ?? "" }),
    );
    return () => sub.unsubscribe();
  }, [watch, onDraftChange]);

  const handleDelete = async () => {
    if (!existing) return;
    const confirmed = await showConfirm(
      deleteCopy.body,
      `Delete “${existing.name}”?`,
      { kind: "destructive", confirmLabel: deleteCopy.confirmLabel },
    );
    if (!confirmed) return;
    deleteSchedule.mutate({ id: existing.id });
    onClose();
  };

  return (
    <form
      onSubmit={handleSubmit((values) => onValid(values as T))}
      className="flex min-h-0 flex-col"
    >
      <DialogHeader title={title} onClose={() => void close()} />

      <DialogBody className="flex flex-col gap-4">
        {leadingFields}
        <FormField label="Name" error={errors.name?.message}>
          <Input
            variant={errors.name ? "invalid" : undefined}
            placeholder={namePlaceholder}
            {...register("name")}
          />
        </FormField>

        {extraFields}

        <FormField label="Prompt" error={errors.task?.message}>
          <Textarea
            className="min-h-[80px] resize-y"
            variant={errors.task ? "invalid" : undefined}
            placeholder="Enter a task prompt"
            rows={3}
            {...register("task")}
          />
        </FormField>

        {showSessionFields && (
          <>
            <ScheduleChoicesField
              agentId={agentId}
              control={control}
              migrationNote={existing?.migrationNote ?? null}
            />
            {afterChoices}
            <ScheduleSessionTitleField
              registration={register("sessionTitle")}
              error={errors.sessionTitle?.message}
            />
          </>
        )}
      </DialogBody>

      <DialogActions
        leading={
          existing ? (
            <Button
              type="button"
              variant="outline"
              tone="danger"
              className="text-danger"
              disabled={deleteSchedule.isPending}
              onClick={() => void handleDelete()}
            >
              {deleteCopy.buttonLabel}
            </Button>
          ) : undefined
        }
        onCancel={() => void close()}
        label={submitLabel}
        pendingLabel={pendingLabel}
        pending={pending}
      />
    </form>
  );
}
