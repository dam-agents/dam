import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";

import { emitToast } from "../../../lib/toast.js";
import type { Schedule } from "../../../types.js";
import {
  useCreateOnceSchedule,
  useUpdateOnceSchedule,
} from "../api/mutations.js";
import { TIMEZONE_OPTIONS } from "../lib/schedule-form-options.js";
import {
  onceFormDefaults,
  onceFormSchema,
  type OnceFormValues,
  onceLocalMoment,
} from "./once-form-schema.js";
import { ScheduleDialog } from "./schedule-dialog.js";
import type { ScheduleDraft } from "./schedule-kind-field.js";

interface Props {
  agentId: string;
  existing?: Schedule;
  draft?: ScheduleDraft;
  onDraftChange?: (draft: ScheduleDraft) => void;
  leadingFields?: ReactNode;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function OnceScheduleForm({
  agentId,
  existing,
  draft,
  onDraftChange,
  leadingFields,
  onClose,
  onDirtyChange,
}: Props) {
  const createOnce = useCreateOnceSchedule();
  const updateOnce = useUpdateOnceSchedule();
  const mutation = existing ? updateOnce : createOnce;

  const form = useForm<OnceFormValues>({
    resolver: zodResolver(onceFormSchema),
    defaultValues: { ...onceFormDefaults(existing), ...draft },
  });
  const { errors } = form.formState;
  const when = form.watch("when");

  const onValid = (v: OnceFormValues) => {
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
      onClose();
    };
    const settings = Object.fromEntries(
      Object.entries(v.settings).filter(([, value]) => value !== ""),
    );
    const fields = {
      name: v.name,
      task: v.task,
      timezone: v.timezone,
      ...(v.harness ? { harness: v.harness } : {}),
      ...(v.model ? { model: v.model } : {}),
      ...(Object.keys(settings).length > 0 ? { settings } : {}),
      ...(v.sessionTitle ? { sessionTitle: v.sessionTitle } : {}),
    };
    if (existing) {
      updateOnce.mutate(
        { id: existing.id, ...fields, at: `${v.date}T${v.time}` },
        { onSuccess },
      );
    } else {
      createOnce.mutate(
        { agentId, ...fields, ...(at ? { at } : {}) },
        { onSuccess },
      );
    }
  };

  return (
    <ScheduleDialog
      title={existing ? "Edit one-time task" : "New schedule"}
      agentId={agentId}
      form={form}
      existing={existing}
      draft={draft}
      onDraftChange={onDraftChange}
      onDirtyChange={onDirtyChange}
      onClose={onClose}
      onValid={onValid}
      pending={mutation.isPending}
      submitLabel={existing ? "Save" : when === "now" ? "Run now" : "Schedule"}
      pendingLabel={existing ? "Saving…" : "Creating…"}
      namePlaceholder="e.g. Release notes"
      deleteCopy={{
        body: "It will not run.",
        confirmLabel: "Delete task",
        buttonLabel: "Delete task",
      }}
      showSessionFields={existing?.inSession !== "continue"}
      leadingFields={leadingFields}
      extraFields={
        <>
          {!existing && (
            <div className="flex flex-col gap-2">
              <SectionLabel>When</SectionLabel>
              <Controller
                control={form.control}
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
              <FormField label="Date" error={errors.date?.message}>
                <Input
                  type="date"
                  variant={errors.date ? "invalid" : undefined}
                  {...form.register("date")}
                />
              </FormField>
              <FormField label="Time" error={errors.time?.message}>
                <Input
                  type="time"
                  variant={errors.time ? "invalid" : undefined}
                  {...form.register("time")}
                />
              </FormField>
            </div>
          )}

          {when === "at" && (
            <FormField label="Timezone" error={errors.timezone?.message}>
              <Controller
                control={form.control}
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
        </>
      }
    />
  );
}
