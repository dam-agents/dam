import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { DialogActions, DialogBody, DialogHeader } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format-time";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useGuardedClose } from "../../sandboxes/hooks/use-guarded-close.js";
import { useDeleteSchedule, useUpdateCronSchedule } from "../api/mutations.js";
import {
  convertCron,
  type ExactCronConversion,
  nextCronRuns,
  PREVIEW_RUNS,
} from "../lib/cron-conversion.js";
import { cronToText } from "../lib/schedule-format.js";
import {
  cronFormDefaults,
  cronFormSchema,
  type CronFormValues,
} from "./cron-form-schema.js";
import {
  ScheduleChoicesField,
  SchedulePrecheckField,
  ScheduleSessionTitleField,
  ScheduleSessionTypeField,
} from "./schedule-fields.js";

interface Props {
  agentId: string;
  existing: Schedule;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onConvert: (draft: Schedule, conversion: ExactCronConversion) => void;
}

const RUN_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

export function CronScheduleForm({
  agentId,
  existing,
  onClose,
  onConvert,
  onDirtyChange,
}: Props) {
  const updateSchedule = useUpdateCronSchedule();
  const deleteSchedule = useDeleteSchedule();
  const showConfirm = useStore((state) => state.showConfirm);
  const [convertProblem, setConvertProblem] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    watch,
    trigger,
    getValues,
    formState,
  } = useForm<CronFormValues>({
    resolver: zodResolver(cronFormSchema),
    defaultValues: cronFormDefaults(existing),
  });
  const { errors, isDirty } = formState;
  const close = useGuardedClose(isDirty, onClose);
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);
  const cron = watch("cron").trim();
  const runs = errors.cron ? [] : nextCronRuns(cron, new Date(), PREVIEW_RUNS);

  const draftOf = (v: CronFormValues): Schedule => {
    const settings = Object.fromEntries(
      Object.entries(v.settings).filter(([, value]) => value !== ""),
    );
    return {
      ...existing,
      name: v.name,
      cron: v.cron.trim(),
      task: v.task,
      precheck: v.precheck.trim() || null,
      harness: v.harness.trim() || null,
      model: v.model.trim() || null,
      settings: Object.keys(settings).length > 0 ? settings : null,
      sessionTitle: v.sessionTitle.trim() || null,
      sessionMode: v.sessionMode,
    };
  };

  const handleConvert = async () => {
    if (!(await trigger())) return;
    const draft = draftOf(getValues());
    const conversion = convertCron(draft.cron ?? "");
    if (conversion.kind === "inexact") {
      setConvertProblem(conversion.reason);
      return;
    }
    onConvert(draft, conversion);
  };

  const handleDelete = async () => {
    const confirmed = await showConfirm(
      "It stops running and cannot be recovered.",
      `Delete “${existing.name}”?`,
      { kind: "destructive", confirmLabel: "Delete schedule" },
    );
    if (!confirmed) return;
    deleteSchedule.mutate({ id: existing.id });
    onClose();
  };

  const onSubmit = handleSubmit((v) => {
    const draft = draftOf(v);
    updateSchedule.mutate(
      {
        id: existing.id,
        name: draft.name,
        cron: draft.cron ?? "",
        task: draft.task ?? "",
        sessionMode: v.sessionMode,
        precheck: draft.precheck,
        harness: draft.harness,
        model: draft.model,
        settings: draft.settings,
        sessionTitle: draft.sessionTitle,
      },
      {
        onSuccess: () => {
          emitToast({ kind: "success", message: `Schedule "${v.name}" saved` });
          onClose();
        },
      },
    );
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
      <DialogHeader title="Edit schedule" onClose={() => void close()} />

      <DialogBody className="flex flex-col gap-4">
        <FormField label="Name" error={errors.name?.message}>
          <Input
            variant={errors.name ? "invalid" : undefined}
            {...register("name")}
          />
        </FormField>

        <FormField label="Cron expression (UTC)" error={errors.cron?.message}>
          <Input
            className="font-mono"
            variant={errors.cron ? "invalid" : undefined}
            placeholder="0 9 * * 1-5"
            {...register("cron", { onChange: () => setConvertProblem(null) })}
          />
        </FormField>
        {runs.length > 0 && (
          <div className="-mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            <p>{cronToText(cron)}, in UTC</p>
            <p>
              Next runs:{" "}
              {runs.map((run) => formatDateTime(run, RUN_FORMAT)).join(" · ")}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm text-muted-foreground">
            This schedule uses the older cron format. It runs in UTC and has no
            quiet hours. Convert it to the new format to pick a timezone and add
            quiet hours.
          </p>
          {convertProblem && (
            <p className="text-sm text-danger">
              It can&apos;t be converted exactly. {convertProblem}
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleConvert()}
            >
              Convert to the new format
            </Button>
          </div>
        </div>

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
          migrationNote={existing.migrationNote}
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
          <Button
            type="button"
            variant="outline"
            tone="danger"
            className="text-danger"
            disabled={deleteSchedule.isPending}
            onClick={() => void handleDelete()}
          >
            Delete
          </Button>
        }
        onCancel={() => void close()}
        label="Save"
        pendingLabel="Saving…"
        pending={updateSchedule.isPending}
      />
    </form>
  );
}
