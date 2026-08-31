import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";

import type { ScheduleDraft } from "../../sandboxes/hooks/use-setup-form.js";
import { ScheduleFormFields } from "./schedule-form-fields.js";
import {
  scheduleFormDefaults,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "./schedule-form-schema.js";

interface Props {
  draft: ScheduleDraft | null;
  onDraftChange: (values: ScheduleFormValues) => void;
}

export function ScheduleInlineForm({ draft, onDraftChange }: Props) {
  const { control, register, watch, formState } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: draft ?? scheduleFormDefaults(),
  });

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  useEffect(() => {
    const sub = watch((values) => {
      onDraftChangeRef.current(values as ScheduleFormValues);
    });
    return () => sub.unsubscribe();
  }, [watch]);

  return (
    <div className="flex flex-col gap-4">
      <ScheduleFormFields
        control={control}
        register={register}
        watch={watch}
        errors={formState.errors}
      />
    </div>
  );
}
