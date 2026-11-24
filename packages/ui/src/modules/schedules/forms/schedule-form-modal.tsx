import { useState } from "react";

import { Modal } from "@/components/modal";

import type { Schedule } from "../../../types.js";
import { useFeatures } from "../../features/api/queries.js";
import { useGuardedClose } from "../../sandboxes/hooks/use-guarded-close.js";
import type { ExactCronConversion } from "../lib/cron-conversion.js";
import type { CreatedSchedule } from "../lib/just-ask.js";
import { ConvertCronStep } from "./convert-cron-step.js";
import { CronScheduleForm } from "./cron-schedule-form.js";
import { OnceScheduleForm } from "./once-schedule-form.js";
import { RecurringScheduleForm } from "./recurring-schedule-form.js";
import {
  type ScheduleDraft,
  type ScheduleKind,
  ScheduleKindField,
} from "./schedule-kind-field.js";

interface Props {
  agentId: string;
  existing?: Schedule;
  onClose: () => void;
  onCreated?: (draft: CreatedSchedule) => void;
}

interface Converting {
  draft: Schedule;
  conversion: ExactCronConversion;
}

export function ScheduleFormModal({
  agentId,
  existing,
  onClose,
  onCreated,
}: Props) {
  /* UNIT_BOUNDARY_DESCRIPTION: the Repeat / Once choice, and with it the one-time task form, only with the one-time-tasks feature on; without it a new schedule repeats, and the edit guard keeps an existing one-time task from reaching this form. */
  const oneTimeTasks = useFeatures().data?.["one-time-tasks"] ?? false;
  const [chosenKind, setKind] = useState<ScheduleKind>(
    existing?.type === "once" ? "once" : "repeat",
  );
  const kind: ScheduleKind = oneTimeTasks ? chosenKind : "repeat";
  const [draft, setDraft] = useState<ScheduleDraft>({ name: "", task: "" });
  const [editing, setEditing] = useState(existing);
  const [converting, setConverting] = useState<Converting | null>(null);
  const [cronDraft, setCronDraft] = useState<Schedule | null>(null);
  const [dirty, setDirty] = useState(false);
  const guardedClose = useGuardedClose(dirty, onClose);
  const onModalClose = () => void guardedClose();

  if (editing?.type === "cron")
    return (
      <Modal onClose={onModalClose}>
        {converting ? (
          <ConvertCronStep
            schedule={converting.draft}
            conversion={converting.conversion}
            onBack={() => {
              setCronDraft(converting.draft);
              setConverting(null);
            }}
            onClose={onClose}
            onConverted={(converted) => {
              setConverting(null);
              setEditing(converted);
            }}
          />
        ) : (
          <CronScheduleForm
            agentId={agentId}
            existing={cronDraft ?? editing}
            onClose={onClose}
            onDirtyChange={setDirty}
            onConvert={(draft, conversion) =>
              setConverting({ draft, conversion })
            }
          />
        )}
      </Modal>
    );

  const formProps = editing
    ? { agentId, existing: editing, onClose, onDirtyChange: setDirty }
    : {
        agentId,
        draft,
        onDraftChange: setDraft,
        leadingFields: oneTimeTasks ? (
          <ScheduleKindField value={kind} onChange={setKind} />
        ) : null,
        onClose,
        onDirtyChange: setDirty,
      };

  return (
    <Modal onClose={onModalClose}>
      {kind === "once" ? (
        <OnceScheduleForm {...formProps} />
      ) : (
        <RecurringScheduleForm {...formProps} onCreated={onCreated} />
      )}
    </Modal>
  );
}
