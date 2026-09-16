import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  ScheduleRecurrenceFields,
  ScheduleSessionTypeField,
} from "./schedule-fields.js";
import {
  buildRRuleParts,
  scheduleFormDefaults,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "./schedule-form-schema.js";

const PRECHECK_HINT =
  "A shell command run before each fire, from the agent's workspace root (/home/agent/work) — so a script in a repo cloned there is ./<repo>/scripts/check.sh. Exit 0 runs the task, exit 1 skips this occurrence without waking a model, and any other exit means the check itself broke — the task runs anyway. Whatever it prints is appended to the prompt.";

interface Props {
  agentId?: string;
  agentChoices?: readonly { id: string; name: string }[];
  existing?: Schedule;
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleFormModal({
  agentId,
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
  const showConfirm = useStore((state) => state.showConfirm);
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

  const quietHoursError =
    errors.quietHours?.message ?? errors.quietHours?.root?.message;

  const onSubmit = handleSubmit((v) => {
    const precheck = v.precheck.trim();
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
      updateSchedule.mutate(
        { id: existing.id, ...common, precheck: precheck || null },
        { onSuccess },
      );
    } else {
      createSchedule.mutate(
        {
          agentId: targetAgentId,
          ...common,
          ...(precheck ? { precheck } : {}),
        },
        { onSuccess },
      );
    }
  });

  return (
    <Modal>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        <DialogHeader
          title={existing ? "Edit schedule" : "Create a new Schedule"}
          onClose={onClose}
        />

        <DialogBody className="flex flex-col gap-4">
          {!existing && agentChoices && (
            <FormField label="Agent" disableInset>
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
            </FormField>
          )}
          <FormField label="Name" error={errors.name?.message} disableInset>
            <Input
              className="h-10"
              variant={errors.name ? "invalid" : undefined}
              placeholder={`eg. "Daily brief"`}
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

          <FormField label="Prompt" error={errors.task?.message} disableInset>
            <Textarea
              className="min-h-[80px] resize-y"
              variant={errors.task ? "invalid" : undefined}
              placeholder="Enter a task prompt"
              rows={3}
              {...register("task")}
            />
          </FormField>

          <FormField
            label="Precheck (optional)"
            error={errors.precheck?.message}
            hint={PRECHECK_HINT}
            disableInset
          >
            <Textarea
              className="min-h-[56px] resize-y font-mono text-xs"
              variant={errors.precheck ? "invalid" : undefined}
              placeholder="git fetch -q && git log --oneline HEAD..origin/main | grep -q ."
              rows={2}
              {...register("precheck")}
            />
          </FormField>

          <ScheduleSessionTypeField layout="stacked" control={control} />
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
                Delete
              </Button>
            ) : undefined
          }
          onCancel={onClose}
          label={existing ? "Save" : "Create"}
          pendingLabel={existing ? "Saving…" : "Creating…"}
          pending={mutation.isPending}
          disabled={!targetAgentId}
        />
      </form>
    </Modal>
  );
}
