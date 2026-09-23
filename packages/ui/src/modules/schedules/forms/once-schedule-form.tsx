import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { DialogActions, DialogBody, DialogHeader } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";
import { Textarea } from "@/components/ui/textarea";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import {
  useCreateOnceSchedule,
  useDeleteSchedule,
  useUpdateOnceSchedule,
} from "../api/mutations.js";
import { TIMEZONE_OPTIONS } from "../lib/schedule-form-options.js";
import {
  onceFormDefaults,
  onceFormSchema,
  type OnceFormValues,
  onceLocalMoment,
} from "./once-form-schema.js";
import { OnceModelField } from "./once-model-field.js";

interface Props {
  targetAgentId: string;
  existing?: Schedule;
  leadingFields?: ReactNode;
  onClose: () => void;
  onSaved: () => void;
}

export function OnceScheduleForm({
  targetAgentId,
  existing,
  leadingFields,
  onClose,
  onSaved,
}: Props) {
  const createOnce = useCreateOnceSchedule();
  const updateOnce = useUpdateOnceSchedule();
  const deleteSchedule = useDeleteSchedule();
  const showConfirm = useStore((state) => state.showConfirm);
  const mutation = existing ? updateOnce : createOnce;

  const { control, register, handleSubmit, watch, formState } =
    useForm<OnceFormValues>({
      resolver: zodResolver(onceFormSchema),
      defaultValues: onceFormDefaults(existing),
    });
  const { errors } = formState;
  const when = watch("when");

  const handleDelete = async () => {
    if (!existing) return;
    const confirmed = await showConfirm(
      "Are you sure you want to cancel this one-time task?",
      `Cancel ${existing.name}?`,
      { kind: "destructive", confirmLabel: "Cancel task" },
    );
    if (!confirmed) return;
    deleteSchedule.mutate({ id: existing.id });
    onClose();
  };

  const onSubmit = handleSubmit((v) => {
    const at = onceLocalMoment(v);
    const onSuccess = () => {
      emitToast({
        kind: "success",
        message: existing
          ? `One-time task "${v.name}" saved`
          : at
            ? `One-time task "${v.name}" scheduled`
            : `One-time task "${v.name}" started`,
      });
      onSaved();
      onClose();
    };
    const fields = {
      name: v.name,
      task: v.task,
      timezone: v.timezone,
      ...(v.model ? { model: v.model } : {}),
    };
    if (existing) {
      updateOnce.mutate(
        { id: existing.id, ...fields, at: `${v.date}T${v.time}` },
        { onSuccess },
      );
    } else {
      createOnce.mutate(
        { agentId: targetAgentId, ...fields, ...(at ? { at } : {}) },
        { onSuccess },
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
      <DialogHeader
        title={existing ? "Edit one-time task" : "Create a new Schedule"}
        onClose={onClose}
      />

      <DialogBody className="flex flex-col gap-4">
        {leadingFields}
        <FormField label="Name" error={errors.name?.message} disableInset>
          <Input
            className="h-10"
            variant={errors.name ? "invalid" : undefined}
            placeholder={`eg. "Release notes"`}
            {...register("name")}
          />
        </FormField>

        {!existing && (
          <div className="flex flex-col gap-2">
            <SectionLabel>When</SectionLabel>
            <Controller
              control={control}
              name="when"
              render={({ field }) => (
                <RadioGroup
                  aria-label="When"
                  className="flex-row gap-6"
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <RadioGroupItem value="now" label="Now" />
                  <RadioGroupItem value="at" label="At a time" />
                </RadioGroup>
              )}
            />
          </div>
        )}

        {when === "at" && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" error={errors.date?.message} disableInset>
              <Input
                type="date"
                className="h-10"
                variant={errors.date ? "invalid" : undefined}
                {...register("date")}
              />
            </FormField>
            <FormField label="Time" error={errors.time?.message} disableInset>
              <Input
                type="time"
                className="h-10"
                variant={errors.time ? "invalid" : undefined}
                {...register("time")}
              />
            </FormField>
          </div>
        )}

        {when === "at" && (
          <FormField
            label="Timezone"
            error={errors.timezone?.message}
            disableInset
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
                />
              )}
            />
          </FormField>
        )}

        {existing?.inSession !== "continue" && (
          <OnceModelField agentId={targetAgentId} register={register} />
        )}

        <FormField label="Prompt" error={errors.task?.message} disableInset>
          <Textarea
            className="min-h-[80px] resize-y"
            variant={errors.task ? "invalid" : undefined}
            placeholder="Enter a task prompt"
            rows={3}
            {...register("task")}
          />
        </FormField>
      </DialogBody>

      <DialogActions
        leading={
          existing ? (
            <Button
              type="button"
              variant="ghost"
              tone="danger"
              className="text-danger"
              disabled={deleteSchedule.isPending}
              onClick={() => void handleDelete()}
            >
              Cancel task
            </Button>
          ) : undefined
        }
        onCancel={onClose}
        label={existing ? "Save" : when === "now" ? "Run now" : "Schedule"}
        pendingLabel={existing ? "Saving…" : "Creating…"}
        pending={mutation.isPending}
        disabled={!targetAgentId}
      />
    </form>
  );
}
